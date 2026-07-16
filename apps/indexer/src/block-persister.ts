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
    const { block, transactions, receipts, logs } = blockData;

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

    await this.drizzle.transaction(async (tx) => {
      await this.persistBlock(tx, blockData, finalityState, canonical);

      for (const transaction of transactions) {
        await this.persistTransaction(tx, transaction, blockNumber, blockHash, canonical);
      }

      for (const receipt of receipts) {
        await this.persistReceipt(tx, receipt, blockNumber, blockHash);
      }

      for (const log of logs) {
        await this.persistLog(tx, log, blockNumber, blockHash, canonical);
      }
    });

    this.logger.info('Block data persisted', {
      blockNumber: blockNumber.toString(),
      blockHash,
    });
  }

  private async persistBlock(
    tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
    blockData: BlockData,
    finalityState: FinalityState,
    canonical: boolean,
  ): Promise<void> {
    const block = blockData.block;
    if (block.number === null || block.hash === null) {
      throw new Error('Block is missing required fields: number or hash');
    }
    const blockNumber = block.number;
    const blockHash = block.hash;

    const data: PersistedBlock = {
      chainId: this.config.chainId,
      number: blockNumber,
      hash: blockHash,
      parentHash: block.parentHash,
      timestamp: new Date(Number(block.timestamp) * 1000),
      finalityState,
      canonical,
    };

    await tx
      .insert(schema.blocks)
      .values({
        chainId: data.chainId,
        number: data.number,
        hash: data.hash,
        parentHash: data.parentHash,
        timestamp: data.timestamp,
        finalityState: data.finalityState,
        canonical: data.canonical,
      })
      .onConflictDoNothing();
  }

  private async persistTransaction(
    tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
    transaction: BlockData['transactions'][0],
    blockNumber: bigint,
    blockHash: Hash,
    canonical: boolean,
  ): Promise<void> {
    if (transaction.transactionIndex === null) {
      throw new Error('Mined transaction is missing its transaction index');
    }
    const txData: PersistedTransaction = {
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
      status: 1,
      gasUsed: transaction.gas ?? 0n,
      effectiveGasPrice: transaction.gasPrice ?? 0n,
      contractCreated: null,
      canonical,
    };

    await tx
      .insert(schema.transactions)
      .values({
        chainId: txData.chainId,
        hash: txData.hash,
        transactionIndex: txData.transactionIndex,
        blockNumber: txData.blockNumber,
        blockHash: txData.blockHash,
        fromAddress: txData.fromAddress,
        toAddress: txData.toAddress,
        nonce: txData.nonce,
        valueRaw: txData.valueRaw,
        input: txData.input,
        status: txData.status,
        gasUsed: txData.gasUsed,
        effectiveGasPrice: txData.effectiveGasPrice,
        contractCreated: txData.contractCreated,
        canonical: txData.canonical,
      })
      .onConflictDoNothing();
  }

  private async persistReceipt(
    tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
    receipt: BlockData['receipts'][0],
    blockNumber: bigint,
    blockHash: Hash,
  ): Promise<void> {
    const receiptData: PersistedReceipt = {
      chainId: this.config.chainId,
      transactionHash: receipt.transactionHash,
      blockNumber,
      blockHash,
      status: receipt.status === 'success' ? 1 : 0,
      gasUsed: receipt.gasUsed,
      cumulativeGasUsed: receipt.cumulativeGasUsed,
      logsCount: receipt.logs.length,
    };

    await tx
      .insert(schema.transactionReceipts)
      .values({
        chainId: receiptData.chainId,
        transactionHash: receiptData.transactionHash,
        blockNumber: receiptData.blockNumber,
        blockHash: receiptData.blockHash,
        status: receiptData.status,
        gasUsed: receiptData.gasUsed,
        cumulativeGasUsed: receiptData.cumulativeGasUsed,
        logsCount: receiptData.logsCount,
      })
      .onConflictDoUpdate({
        target: [schema.transactionReceipts.chainId, schema.transactionReceipts.transactionHash],
        set: {
          status: receiptData.status,
          gasUsed: receiptData.gasUsed,
          cumulativeGasUsed: receiptData.cumulativeGasUsed,
          logsCount: receiptData.logsCount,
        },
      });

    await tx
      .update(schema.transactions)
      .set({
        status: receiptData.status,
        gasUsed: receiptData.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        contractCreated: receipt.contractAddress,
      })
      .where(
        and(
          eq(schema.transactions.chainId, receiptData.chainId),
          eq(schema.transactions.hash, receiptData.transactionHash),
        ),
      );
  }

  private async persistLog(
    tx: Parameters<Parameters<Database['db']['transaction']>[0]>[0],
    log: BlockData['logs'][0],
    blockNumber: bigint,
    blockHash: Hash,
    canonical: boolean,
  ): Promise<void> {
    if (log.transactionHash === null || log.transactionIndex === null || log.logIndex === null) {
      throw new Error('Log is missing required transaction provenance');
    }

    const logData: PersistedLog = {
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

    await tx
      .insert(schema.logs)
      .values({
        chainId: logData.chainId,
        transactionHash: logData.transactionHash,
        transactionIndex: logData.transactionIndex,
        logIndex: logData.logIndex,
        blockHash: logData.blockHash,
        blockNumber: logData.blockNumber,
        address: logData.address,
        topic0: logData.topic0,
        topic1: logData.topic1,
        topic2: logData.topic2,
        topic3: logData.topic3,
        data: logData.data,
        removed: logData.removed,
        canonical: logData.canonical,
      })
      .onConflictDoNothing();
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
