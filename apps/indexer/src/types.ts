import type { DerivedJobType } from '@hood-sentry/queue';
import type { Block, Hash, Hex, Log, Transaction, TransactionReceipt } from 'viem';

export type IndexerMode =
  | 'live'
  | 'historical'
  | 'gap-repair'
  | 'reorg-reconciliation'
  | 'contract-replay';

export type FinalityState = 'pending' | 'soft_confirmed' | 'safe' | 'finalized' | 'orphaned';

export interface IndexerConfig {
  chainId: bigint;
  workerId: string;
  mode: IndexerMode;
  batchSize: number;
  /**
   * Maximum concurrent block fetches during catch-up. Kept low by default so a
   * rate-limited RPC provider is not flooded into HTTP 429s; raise it once the
   * provider has the compute-unit budget to serve the extra parallelism.
   */
  maxConcurrency: number;
  /**
   * Drain the catch-up backlog with one `eth_getLogs` call per window instead of
   * a body and receipt fetch per block. Fast enough to outrun the chain on a
   * rate-limited provider, at the cost of indexing no transactions or receipts.
   */
  logWindowEnabled: boolean;
  /**
   * Event topics worth storing, derived from the active protocol adapters plus
   * the ERC-20 events discovery is built on. Empty or absent stores every log.
   */
  indexableTopics?: readonly string[];
  /**
   * Blocks of raw logs, transactions and receipts kept behind the indexed head.
   * Zero keeps everything.
   */
  rawDataRetentionBlocks: bigint;
  /**
   * Keep the raw event log after deriving from it. Derived records carry their
   * own provenance, so the raw rows are a second copy of the chain that the
   * product never reads. Contract-replay mode is the exception and needs them.
   */
  persistRawLogs: boolean;
  retentionPruneIntervalMs: number;
  pollIntervalMs: number;
  leaseDurationMs: number;
  leaseRenewalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  startBlock?: bigint;
  endBlock?: bigint;
  targetContracts?: string[];
  finalityConfirmations: number;
  safeConfirmations: number;
}

export interface Checkpoint {
  chainId: bigint;
  stream: string;
  nextBlock: bigint;
  lastBlockHash: Hash | null;
  lockedBy: string | null;
  updatedAt: Date;
}

export interface Lease {
  chainId: bigint;
  stream: string;
  workerId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface BlockData {
  block: Block;
  transactions: Transaction[];
  receipts: TransactionReceipt[];
  logs: Log[];
}

export interface PersistedBlock {
  chainId: bigint;
  number: bigint;
  hash: Hash;
  parentHash: Hash;
  timestamp: Date;
  finalityState: FinalityState;
  canonical: boolean;
}

export interface PersistedTransaction {
  chainId: bigint;
  hash: Hash;
  transactionIndex: number;
  blockNumber: bigint;
  blockHash: Hash;
  fromAddress: string;
  toAddress: string | null;
  nonce: bigint;
  valueRaw: string;
  input: Hex | null;
  status: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  contractCreated: string | null;
  canonical: boolean;
}

export interface PersistedReceipt {
  chainId: bigint;
  transactionHash: Hash;
  blockNumber: bigint;
  blockHash: Hash;
  status: number;
  gasUsed: bigint;
  cumulativeGasUsed: bigint;
  logsCount: number;
}

export interface PersistedLog {
  chainId: bigint;
  transactionHash: Hash;
  transactionIndex: number;
  logIndex: number;
  blockHash: Hash;
  blockNumber: bigint;
  address: string;
  topic0: Hex | null;
  topic1: Hex | null;
  topic2: Hex | null;
  topic3: Hex | null;
  data: Hex;
  removed: boolean;
  canonical: boolean;
}

export interface ReorgEvent {
  id: bigint;
  chainId: bigint;
  fromBlock: bigint;
  toBlock: bigint;
  commonAncestorBlock: bigint;
  blocksOrphaned: number;
  detectedAt: Date;
  resolvedAt: Date | null;
}

export interface GapRange {
  chainId: bigint;
  fromBlock: bigint;
  toBlock: bigint;
}

export interface DerivedJob {
  type: DerivedJobType;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hash;
  data: Record<string, unknown>;
}

export interface IndexerMetrics {
  blocksIndexed: number;
  transactionsIndexed: number;
  logsIndexed: number;
  reorgsDetected: number;
  gapsFound: number;
  lastBlockNumber: bigint | null;
  lastBlockTimestamp: Date | null;
  avgBlockTimeMs: number;
  lag: number;
}

export interface IndexerStatus {
  mode: IndexerMode;
  running: boolean;
  paused: boolean;
  currentBlock: bigint | null;
  targetBlock: bigint | null;
  metrics: IndexerMetrics;
  errors: IndexerError[];
}

export interface IndexerError {
  timestamp: Date;
  blockNumber: bigint | null;
  error: string;
  stack?: string;
  retryCount: number;
}
