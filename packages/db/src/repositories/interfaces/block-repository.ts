import type { CursorPaginationOptions, PaginatedResult } from '../../core/pagination.js';
import type { TransactionContext } from '../../core/transaction.js';

export interface Block {
  chainId: bigint;
  number: bigint;
  hash: string;
  parentHash: string;
  timestamp: Date;
  finalityState: string;
  canonical: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Log {
  id: string;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string;
  removed: boolean;
  canonical: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChainStatus {
  chainId: bigint;
  /** Latest chain head the indexer has observed, or null before the first tick. */
  headBlock: bigint | null;
  /** Latest finalized block, or null before the first tick. */
  finalizedBlock: bigint | null;
  /** Highest block the indexer has persisted (max checkpoint next_block − 1). */
  latestIndexedBlock: bigint | null;
}

export interface BlockRepository {
  getBlock(chainId: bigint, blockNumber: bigint, tx?: TransactionContext): Promise<Block | null>;

  /** Chain head, finalized, and latest-indexed heights for a live status readout. */
  getChainStatus(chainId: bigint, tx?: TransactionContext): Promise<ChainStatus | null>;

  getBlockByHash(
    chainId: bigint,
    blockHash: string,
    tx?: TransactionContext,
  ): Promise<Block | null>;

  getLatestBlock(chainId: bigint, tx?: TransactionContext): Promise<Block | null>;

  getBlocksInRange(
    chainId: bigint,
    fromBlock: bigint,
    toBlock: bigint,
    tx?: TransactionContext,
  ): Promise<Block[]>;

  insertBlock(
    block: Omit<Block, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Block>;

  upsertBlock(
    block: Omit<Block, 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Block>;

  markBlocksOrphaned(chainId: bigint, fromBlock: bigint, tx?: TransactionContext): Promise<number>;

  deleteBlocks(
    chainId: bigint,
    fromBlock: bigint,
    toBlock: bigint,
    tx?: TransactionContext,
  ): Promise<number>;
}

export interface LogRepository {
  getLog(id: string, tx?: TransactionContext): Promise<Log | null>;

  getLogsByBlock(chainId: bigint, blockNumber: bigint, tx?: TransactionContext): Promise<Log[]>;

  getLogsByTransaction(
    chainId: bigint,
    transactionHash: string,
    tx?: TransactionContext,
  ): Promise<Log[]>;

  getLogsByAddress(
    chainId: bigint,
    address: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Log>>;

  getLogsByTopic(
    chainId: bigint,
    topic0: string,
    options: CursorPaginationOptions,
    tx?: TransactionContext,
  ): Promise<PaginatedResult<Log>>;

  insertLog(
    log: Omit<Log, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<Log>;

  insertLogs(
    logs: Omit<Log, 'id' | 'createdAt' | 'updatedAt'>[],
    tx?: TransactionContext,
  ): Promise<Log[]>;

  deleteLogs(chainId: bigint, blockNumber: bigint, tx?: TransactionContext): Promise<number>;
}
