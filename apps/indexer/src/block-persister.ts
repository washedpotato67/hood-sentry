import type { Database } from '@hood-sentry/db';
import { schema } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { Hash } from 'viem';
import type {
  BlockData,
  FinalityState,
  IndexerConfig,
  PersistedBlock,
  PersistedLog,
  PersistedReceipt,
  PersistedTransaction,
} from './types.js';

// Logs carry ~14 bound parameters each; 1000 rows keeps a single insert far
// below Postgres' 65535-parameter limit while still collapsing the round-trips.
const LOG_INSERT_CHUNK_SIZE = 1000;

// Transaction rows are the widest, at ~17 bound parameters each.
const ROW_INSERT_CHUNK_SIZE = 1000;

function chunked<T>(rows: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

export class BlockPersister {
  private readonly drizzle: Database['db'];

  constructor(
    database: Database,
    private readonly config: IndexerConfig,
    private readonly logger: Logger,
  ) {
    this.drizzle = database.db;
  }

  async persistBlockData(
    blockData: BlockData,
    finalityState: FinalityState,
    canonical = true,
  ): Promise<void> {
    const { block, transactions, logs } = blockData;

    const blockNumber = block.number;
    const blockHash = block.hash;
    if (blockNumber === null || blockHash === null) {
      this.logger.warn('Skipping block with null number or hash');
      return;
    }

    this.logger.debug('Persisting block data', {
      blockNumber: blockNumber.toString(),
      blockHash,
      transactionCount: transactions.length,
      logCount: logs.length,
      finalityState,
      canonical,
    });

    // A dense block holds dozens of transactions and hundreds of logs. Writing
    // them one row at a time is hundreds of sequential round-trips per block and
    // is the dominant cost when catching up. Batch each table into multi-row
    // inserts instead. Receipt fields are merged into the transaction row so the
    // per-transaction follow-up UPDATE disappears too. Rows are immutable for a
    // finalized block, so onConflictDoNothing is a safe replay guard.
    await this.drizzle.transaction(async (tx) => {
      await this.writeBlockData(tx, blockData, finalityState, canonical);
    });

    this.logger.info('Block data persisted', {
      blockNumber: blockNumber.toString(),
      blockHash,
    });
  }

  /**
   * Persist a whole window of blocks as one transaction and one insert per
   * table.
   *
   * Every statement costs a round trip, so writing block by block spent roughly
   * two dozen of them per window; on a database tens of milliseconds away that
   * was the dominant cost of catching up. Collecting the window's rows first
   * turns it into a handful. Writing the window as a unit also makes it atomic:
   * a failure part way through rolls back rather than leaving the checkpoint's
   * blocks half written.
   */
  async persistBlockWindow(
    blocks: readonly BlockData[],
    finalityState: FinalityState,
    canonical = true,
  ): Promise<void> {
    if (blocks.length === 0) return;

    const blockRows: ReturnType<BlockPersister['buildBlockRow']>[] = [];
    const transactionRows: ReturnType<BlockPersister['buildTransactionRow']>[] = [];
    const receiptRows: ReturnType<BlockPersister['buildReceiptRow']>[] = [];
    const logRows: ReturnType<BlockPersister['buildLogRow']>[] = [];

    for (const blockData of blocks) {
      const blockNumber = blockData.block.number;
      const blockHash = blockData.block.hash;
      if (blockNumber === null || blockHash === null) {
        this.logger.warn('Skipping block with null number or hash');
        continue;
      }

      blockRows.push(this.buildBlockRow(blockData, finalityState, canonical));

      const receiptByTxHash = new Map(
        blockData.receipts.map((receipt) => [receipt.transactionHash, receipt]),
      );
      for (const transaction of blockData.transactions) {
        transactionRows.push(
          this.buildTransactionRow(
            transaction,
            receiptByTxHash.get(transaction.hash),
            blockNumber,
            blockHash,
            canonical,
          ),
        );
      }
      for (const receipt of blockData.receipts) {
        receiptRows.push(this.buildReceiptRow(receipt, blockNumber, blockHash));
      }
      if (this.config.persistRawLogs) {
        for (const log of blockData.logs) {
          logRows.push(this.buildLogRow(log, blockNumber, blockHash, canonical));
        }
      }
    }

    await this.drizzle.transaction(async (tx) => {
      // Blocks first: the fact tables reference them.
      for (const chunk of chunked(blockRows, ROW_INSERT_CHUNK_SIZE)) {
        await tx.insert(schema.blocks).values(chunk).onConflictDoNothing();
      }
      for (const chunk of chunked(transactionRows, ROW_INSERT_CHUNK_SIZE)) {
        await tx.insert(schema.transactions).values(chunk).onConflictDoNothing();
      }
      for (const chunk of chunked(receiptRows, ROW_INSERT_CHUNK_SIZE)) {
        await tx.insert(schema.transactionReceipts).values(chunk).onConflictDoNothing();
      }
      for (const chunk of chunked(logRows, LOG_INSERT_CHUNK_SIZE)) {
        await tx.insert(schema.logs).values(chunk).onConflictDoNothing();
      }
    });

    this.logger.info('Block window persisted', {
      fromBlock: blocks[0]?.block.number?.toString(),
      toBlock: blocks[blocks.length - 1]?.block.number?.toString(),
      count: blocks.length,
    });
  }

  private async writeBlockData(
    tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
    blockData: BlockData,
    finalityState: FinalityState,
    canonical: boolean,
  ): Promise<void> {
    const { block, transactions, receipts, logs } = blockData;
    const blockNumber = block.number;
    const blockHash = block.hash;
    if (blockNumber === null || blockHash === null) {
      this.logger.warn('Skipping block with null number or hash');
      return;
    }

    const receiptByTxHash = new Map(receipts.map((receipt) => [receipt.transactionHash, receipt]));

    await this.persistBlock(tx, blockData, finalityState, canonical);

    if (transactions.length > 0) {
      const rows = transactions.map((transaction) =>
        this.buildTransactionRow(
          transaction,
          receiptByTxHash.get(transaction.hash),
          blockNumber,
          blockHash,
          canonical,
        ),
      );
      await tx.insert(schema.transactions).values(rows).onConflictDoNothing();
    }

    if (receipts.length > 0) {
      const rows = receipts.map((receipt) => this.buildReceiptRow(receipt, blockNumber, blockHash));
      await tx.insert(schema.transactionReceipts).values(rows).onConflictDoNothing();
    }

    if (logs.length > 0 && this.config.persistRawLogs) {
      const rows = logs.map((log) => this.buildLogRow(log, blockNumber, blockHash, canonical));
      // Chunked to stay well under Postgres' bind-parameter ceiling.
      for (let i = 0; i < rows.length; i += LOG_INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + LOG_INSERT_CHUNK_SIZE);
        await tx.insert(schema.logs).values(chunk).onConflictDoNothing();
      }
    }
  }

  private async persistBlock(
    tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
    blockData: BlockData,
    finalityState: FinalityState,
    canonical: boolean,
  ): Promise<void> {
    await tx
      .insert(schema.blocks)
      .values(this.buildBlockRow(blockData, finalityState, canonical))
      .onConflictDoNothing();
  }

  private buildBlockRow(
    blockData: BlockData,
    finalityState: FinalityState,
    canonical: boolean,
  ): {
    chainId: bigint;
    number: bigint;
    hash: `0x${string}`;
    parentHash: `0x${string}`;
    timestamp: Date;
    finalityState: FinalityState;
    canonical: boolean;
  } {
    const block = blockData.block;
    if (block.number === null || block.hash === null) {
      throw new Error('Block is missing required fields: number or hash');
    }

    const data: PersistedBlock = {
      chainId: this.config.chainId,
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: new Date(Number(block.timestamp) * 1000),
      finalityState,
      canonical,
    };

    return {
      chainId: data.chainId,
      number: data.number,
      hash: data.hash,
      parentHash: data.parentHash,
      timestamp: data.timestamp,
      finalityState: data.finalityState,
      canonical: data.canonical,
    };
  }

  private buildTransactionRow(
    transaction: BlockData['transactions'][0],
    receipt: BlockData['receipts'][0] | undefined,
    blockNumber: bigint,
    blockHash: Hash,
    canonical: boolean,
  ): PersistedTransaction {
    if (transaction.transactionIndex === null) {
      throw new Error('Mined transaction is missing its transaction index');
    }
    // Merge the receipt's authoritative execution result into the row so no
    // follow-up UPDATE is needed. Without a receipt we fall back to the
    // transaction's own gas fields and an optimistic success status.
    return {
      chainId: this.config.chainId,
      hash: transaction.hash,
      transactionIndex: transaction.transactionIndex,
      blockNumber,
      blockHash,
      fromAddress: transaction.from,
      toAddress: transaction.to,
      nonce: BigInt(transaction.nonce),
      valueRaw: transaction.value.toString(),
      input: transaction.input,
      status: receipt ? (receipt.status === 'success' ? 1 : 0) : 1,
      gasUsed: receipt?.gasUsed ?? transaction.gas ?? 0n,
      effectiveGasPrice: receipt?.effectiveGasPrice ?? transaction.gasPrice ?? 0n,
      contractCreated: receipt?.contractAddress ?? null,
      canonical,
    };
  }

  private buildReceiptRow(
    receipt: BlockData['receipts'][0],
    blockNumber: bigint,
    blockHash: Hash,
  ): PersistedReceipt {
    return {
      chainId: this.config.chainId,
      transactionHash: receipt.transactionHash,
      blockNumber,
      blockHash,
      status: receipt.status === 'success' ? 1 : 0,
      gasUsed: receipt.gasUsed,
      cumulativeGasUsed: receipt.cumulativeGasUsed,
      logsCount: receipt.logs.length,
    };
  }

  private buildLogRow(
    log: BlockData['logs'][0],
    blockNumber: bigint,
    blockHash: Hash,
    canonical: boolean,
  ): PersistedLog {
    if (log.transactionHash === null || log.transactionIndex === null || log.logIndex === null) {
      throw new Error('Log is missing required transaction provenance');
    }

    return {
      chainId: this.config.chainId,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      logIndex: log.logIndex,
      blockHash,
      blockNumber,
      address: log.address,
      topic0: log.topics[0] ?? null,
      topic1: log.topics[1] ?? null,
      topic2: log.topics[2] ?? null,
      topic3: log.topics[3] ?? null,
      data: log.data,
      removed: log.removed,
      canonical,
    };
  }

  async updateBlockFinality(
    blockNumber: bigint,
    blockHash: Hash,
    finalityState: FinalityState,
  ): Promise<void> {
    await this.drizzle
      .update(schema.blocks)
      .set({ finalityState })
      .where(
        and(
          eq(schema.blocks.chainId, this.config.chainId),
          eq(schema.blocks.number, blockNumber),
          eq(schema.blocks.hash, blockHash),
        ),
      );
  }

  async markBlocksOrphaned(fromBlock: bigint, toBlock: bigint): Promise<void> {
    await this.drizzle
      .update(schema.blocks)
      .set({ canonical: false, finalityState: 'orphaned' })
      .where(
        and(
          eq(schema.blocks.chainId, this.config.chainId),
          gte(schema.blocks.number, fromBlock),
          lte(schema.blocks.number, toBlock),
          eq(schema.blocks.canonical, true),
        ),
      );
  }

  async deleteOrphanedBlocks(fromBlock: bigint, toBlock: bigint): Promise<void> {
    await this.drizzle
      .delete(schema.blocks)
      .where(
        and(
          eq(schema.blocks.chainId, this.config.chainId),
          gte(schema.blocks.number, fromBlock),
          lte(schema.blocks.number, toBlock),
          eq(schema.blocks.canonical, false),
        ),
      );
  }
}
