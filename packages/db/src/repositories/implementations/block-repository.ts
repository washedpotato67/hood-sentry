import { and, asc, desc, eq, gt, gte, lt, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Database } from '../../client.js';
import {
  type CursorPaginationOptions,
  type PaginatedResult,
  buildPaginatedResult,
  decodeCursorAsDate,
} from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';
import { blocks, chains, indexerCheckpoints, logs } from '../../schema/chain-facts.js';
import type {
  Block,
  ChainStatus,
  BlockRepository as IBlockRepository,
  LogRepository as ILogRepository,
  Log,
} from '../interfaces/block-repository.js';

// biome-ignore lint/suspicious/noExplicitAny: Executor needs to accept any schema
type Executor = PostgresJsDatabase<any>;

type BlockRow = typeof blocks.$inferSelect;
type LogRow = typeof logs.$inferSelect;

function mapBlockRow(row: BlockRow): Block {
  return {
    chainId: row.chainId,
    number: row.number,
    hash: row.hash,
    parentHash: row.parentHash,
    timestamp: row.timestamp,
    finalityState: row.finalityState,
    canonical: row.canonical,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildLogId(row: LogRow): string {
  return `${row.chainId}:${row.transactionHash}:${row.logIndex}:${row.blockHash}`;
}

function mapLogRow(row: LogRow): Log {
  return {
    id: buildLogId(row),
    chainId: row.chainId,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    transactionHash: row.transactionHash,
    transactionIndex: 0,
    logIndex: row.logIndex,
    address: row.address,
    topic0: row.topic0 ?? null,
    topic1: row.topic1 ?? null,
    topic2: row.topic2 ?? null,
    topic3: row.topic3 ?? null,
    data: row.data,
    removed: row.removed,
    canonical: row.canonical,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseLogId(id: string): {
  chainId: bigint;
  transactionHash: string;
  logIndex: number;
  blockHash: string;
} {
  const parts = id.split(':');
  if (parts.length !== 4) {
    throw new Error(`Invalid log id: ${id}`);
  }
  const [chainIdStr, transactionHash, logIndexStr, blockHash] = parts;
  if (!chainIdStr || !transactionHash || !logIndexStr || !blockHash) {
    throw new Error(`Invalid log id: ${id}`);
  }
  return {
    chainId: BigInt(chainIdStr),
    transactionHash,
    logIndex: Number(logIndexStr),
    blockHash,
  };
}

export class BlockRepository implements IBlockRepository {
  private readonly db: Executor;

  constructor(database: Database['db']) {
    this.db = database as Executor;
  }

  private resolve(tx?: TransactionContext): Executor {
    return (tx ?? this.db) as Executor;
  }

  async getBlock(
    chainId: bigint,
    blockNumber: bigint,
    tx?: TransactionContext,
  ): Promise<Block | null> {
    const rows = await this.resolve(tx)
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.chainId, chainId),
          eq(blocks.number, blockNumber),
          eq(blocks.canonical, true),
        ),
      )
      .orderBy(asc(blocks.number))
      .limit(1);

    const row = rows[0];
    return row ? mapBlockRow(row) : null;
  }

  async getChainStatus(chainId: bigint, tx?: TransactionContext): Promise<ChainStatus | null> {
    const executor = this.resolve(tx);
    const chainRows = await executor
      .select({
        headBlock: chains.headBlockNumber,
        finalizedBlock: chains.finalizedBlockNumber,
      })
      .from(chains)
      .where(eq(chains.chainId, chainId))
      .limit(1);

    const chain = chainRows[0];
    if (!chain) return null;

    // Latest indexed height = the furthest checkpoint's next_block − 1 (next_block
    // is the block the indexer will read next, so one below it is the last stored).
    const checkpointRows = await executor
      .select({ nextBlock: indexerCheckpoints.nextBlock })
      .from(indexerCheckpoints)
      .where(eq(indexerCheckpoints.chainId, chainId))
      .orderBy(desc(indexerCheckpoints.nextBlock))
      .limit(1);

    const nextBlock = checkpointRows[0]?.nextBlock ?? null;
    const latestIndexedBlock = nextBlock !== null && nextBlock > 0n ? nextBlock - 1n : null;

    return {
      chainId,
      headBlock: chain.headBlock ?? null,
      finalizedBlock: chain.finalizedBlock ?? null,
      latestIndexedBlock,
    };
  }

  async getBlockByHash(
    chainId: bigint,
    blockHash: string,
    tx?: TransactionContext,
  ): Promise<Block | null> {
    const rows = await this.resolve(tx)
      .select()
      .from(blocks)
      .where(and(eq(blocks.chainId, chainId), eq(blocks.hash, blockHash)))
      .limit(1);

    const row = rows[0];
    return row ? mapBlockRow(row) : null;
  }

  async getLatestBlock(chainId: bigint, tx?: TransactionContext): Promise<Block | null> {
    const rows = await this.resolve(tx)
      .select()
      .from(blocks)
      .where(and(eq(blocks.chainId, chainId), eq(blocks.canonical, true)))
      .orderBy(desc(blocks.number))
      .limit(1);

    const row = rows[0];
    return row ? mapBlockRow(row) : null;
  }

  async getBlocksInRange(
    chainId: bigint,
    fromBlock: bigint,
    toBlock: bigint,
    tx?: TransactionContext,
  ): Promise<Block[]> {
    const rows = await this.resolve(tx)
      .select()
      .from(blocks)
      .where(
        and(
          eq(blocks.chainId, chainId),
          gte(blocks.number, fromBlock),
          lte(blocks.number, toBlock),
          eq(blocks.canonical, true),
        ),
      )
      .orderBy(asc(blocks.number));

    return rows.map(mapBlockRow);
  }

  async insertBlock(
    block: Omit<Block, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Block> {
    const rows = await this.resolve(tx)
      .insert(blocks)
      .values({
        chainId: block.chainId,
        number: block.number,
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: block.timestamp,
        finalityState: block.finalityState,
        canonical: block.canonical,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('insertBlock: no row returned');
    }
    return mapBlockRow(row);
  }

  async upsertBlock(
    block: Omit<Block, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Block> {
    const rows = await this.resolve(tx)
      .insert(blocks)
      .values({
        chainId: block.chainId,
        number: block.number,
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: block.timestamp,
        finalityState: block.finalityState,
        canonical: block.canonical,
      })
      .onConflictDoUpdate({
        target: [blocks.chainId, blocks.number, blocks.hash],
        set: {
          parentHash: block.parentHash,
          timestamp: block.timestamp,
          finalityState: block.finalityState,
          canonical: block.canonical,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('upsertBlock: no row returned');
    }
    return mapBlockRow(row);
  }

  async markBlocksOrphaned(
    chainId: bigint,
    fromBlock: bigint,
    tx?: TransactionContext,
  ): Promise<number> {
    const result = await this.resolve(tx)
      .update(blocks)
      .set({ canonical: false, updatedAt: new Date() })
      .where(
        and(eq(blocks.chainId, chainId), gte(blocks.number, fromBlock), eq(blocks.canonical, true)),
      )
      .returning();

    return result.length;
  }

  async deleteBlocks(
    chainId: bigint,
    fromBlock: bigint,
    toBlock: bigint,
    tx?: TransactionContext,
  ): Promise<number> {
    const result = await this.resolve(tx)
      .delete(blocks)
      .where(
        and(
          eq(blocks.chainId, chainId),
          gte(blocks.number, fromBlock),
          lte(blocks.number, toBlock),
        ),
      )
      .returning();

    return result.length;
  }
}

export class LogRepository implements ILogRepository {
  private readonly db: Executor;

  constructor(database: Database['db']) {
    this.db = database as Executor;
  }

  private resolve(tx?: TransactionContext): Executor {
    return (tx ?? this.db) as Executor;
  }

  async getLog(id: string, tx?: TransactionContext): Promise<Log | null> {
    const parsed = parseLogId(id);
    const rows = await this.resolve(tx)
      .select()
      .from(logs)
      .where(
        and(
          eq(logs.chainId, parsed.chainId),
          eq(logs.transactionHash, parsed.transactionHash),
          eq(logs.logIndex, parsed.logIndex),
          eq(logs.blockHash, parsed.blockHash),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? mapLogRow(row) : null;
  }

  async getLogsByBlock(
    chainId: bigint,
    blockNumber: bigint,
    tx?: TransactionContext,
  ): Promise<Log[]> {
    const rows = await this.resolve(tx)
      .select()
      .from(logs)
      .where(and(eq(logs.chainId, chainId), eq(logs.blockNumber, blockNumber)))
      .orderBy(asc(logs.logIndex));

    return rows.map(mapLogRow);
  }

  async getLogsByTransaction(
    chainId: bigint,
    transactionHash: string,
    tx?: TransactionContext,
  ): Promise<Log[]> {
    const rows = await this.resolve(tx)
      .select()
      .from(logs)
      .where(and(eq(logs.chainId, chainId), eq(logs.transactionHash, transactionHash)))
      .orderBy(asc(logs.logIndex));

    return rows.map(mapLogRow);
  }

  async getLogsByAddress(
    chainId: bigint,
    address: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Log>> {
    const { limit, cursor, orderBy } = options;
    const orderFn = orderBy === 'asc' ? asc : desc;
    const cursorOp = orderBy === 'asc' ? gt : lt;

    const conditions = [eq(logs.chainId, chainId), eq(logs.address, address)];

    if (cursor) {
      conditions.push(cursorOp(logs.createdAt, decodeCursorAsDate(cursor)));
    }

    const rows = await this.resolve(tx)
      .select()
      .from(logs)
      .where(and(...conditions))
      .orderBy(orderFn(logs.createdAt), asc(logs.logIndex))
      .limit(limit + 1);

    return buildPaginatedResult(rows.map(mapLogRow), limit, (item) => item.createdAt);
  }

  async getLogsByTopic(
    chainId: bigint,
    topic0: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Log>> {
    const { limit, cursor, orderBy } = options;
    const orderFn = orderBy === 'asc' ? asc : desc;
    const cursorOp = orderBy === 'asc' ? gt : lt;

    const conditions = [eq(logs.chainId, chainId), eq(logs.topic0, topic0)];

    if (cursor) {
      conditions.push(cursorOp(logs.createdAt, decodeCursorAsDate(cursor)));
    }

    const rows = await this.resolve(tx)
      .select()
      .from(logs)
      .where(and(...conditions))
      .orderBy(orderFn(logs.createdAt), asc(logs.logIndex))
      .limit(limit + 1);

    return buildPaginatedResult(rows.map(mapLogRow), limit, (item) => item.createdAt);
  }

  async insertLog(
    log: Omit<Log, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Log> {
    const rows = await this.resolve(tx)
      .insert(logs)
      .values({
        chainId: log.chainId,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        address: log.address,
        topic0: log.topic0,
        topic1: log.topic1,
        topic2: log.topic2,
        topic3: log.topic3,
        data: log.data,
        removed: log.removed,
        canonical: log.canonical,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error('insertLog: no row returned');
    }
    return mapLogRow(row);
  }

  async insertLogs(
    logEntries: Omit<Log, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<Log[]> {
    if (logEntries.length === 0) {
      return [];
    }

    const rows = await this.resolve(tx)
      .insert(logs)
      .values(
        logEntries.map((log) => ({
          chainId: log.chainId,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          address: log.address,
          topic0: log.topic0,
          topic1: log.topic1,
          topic2: log.topic2,
          topic3: log.topic3,
          data: log.data,
          removed: log.removed,
          canonical: log.canonical,
        })),
      )
      .returning();

    return rows.map(mapLogRow);
  }

  async deleteLogs(chainId: bigint, blockNumber: bigint, tx?: TransactionContext): Promise<number> {
    const result = await this.resolve(tx)
      .delete(logs)
      .where(and(eq(logs.chainId, chainId), eq(logs.blockNumber, blockNumber)))
      .returning();

    return result.length;
  }
}
