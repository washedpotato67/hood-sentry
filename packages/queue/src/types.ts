import type { DerivedJobType } from './job-types.js';

/** A derived job as produced by the indexer, before serialization. */
export interface DerivedJobInput {
  type: DerivedJobType;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: string;
  data: Record<string, unknown>;
}

/**
 * The JSON-safe shape stored in Redis (bigints rendered as decimal strings).
 * `type` stays a string here: a payload read back from Redis is untrusted input
 * and must be narrowed with `isDerivedJobType` before routing.
 */
export interface DerivedJobPayload {
  type: string;
  chainId: string;
  blockNumber: string;
  blockHash: string;
  data: Record<string, unknown>;
}

/** Handles a single derived job. Throwing triggers BullMQ retry/dead-letter handling. */
export type DerivedJobHandler = (payload: DerivedJobPayload) => Promise<void>;

/** Publishes a derived job idempotently. Structurally matches the indexer's publisher seam. */
export interface DerivedJobPublisher {
  publish(job: DerivedJobInput, idempotencyKey: string): Promise<void>;
  /**
   * Publish a group in one round trip. Each job costs a round trip to enqueue,
   * and a block's worth of them is a meaningful share of the time to index it.
   * Optional so existing publishers stay valid; callers fall back to `publish`.
   */
  publishMany?(entries: readonly { job: DerivedJobInput; idempotencyKey: string }[]): Promise<void>;
}

/** A derived job that exhausted its retries, as stored in the dead-letter queue. */
export interface DeadLetteredJob {
  payload: DerivedJobPayload;
  originalJobId: string;
  attemptsMade: number;
  failedReason: string;
  deadLetteredAt: string;
}

/**
 * Deterministic idempotency key for a derived job.
 * Identical chain positions collapse to the same key so a replayed block never
 * enqueues a duplicate.
 */
/**
 * Job types whose work is about a token rather than about a block. A token's
 * name, symbol and decimals never change, and its ranking is recomputed from
 * whatever evidence has landed, so one pending job per token is enough no matter
 * how many blocks it appears in.
 */
const TOKEN_SCOPED_JOB_TYPES = new Set(['token-metadata', 'discovery-refresh']);

export function isTokenScopedJobType(type: string): boolean {
  return TOKEN_SCOPED_JOB_TYPES.has(type);
}

/**
 * Key a token-scoped job by the token alone. Including the block would make
 * every sighting a distinct job, so a token active in a thousand blocks would
 * queue a thousand jobs to learn the same unchanging facts.
 */
export function tokenScopedIdempotencyKey(job: {
  type: string;
  chainId: bigint | number;
  tokenAddress: string;
}): string {
  return `${job.chainId.toString()}:${job.type}:${job.tokenAddress.toLowerCase()}`;
}

export function derivedJobIdempotencyKey(
  job: Pick<DerivedJobInput, 'type' | 'chainId' | 'blockHash'> & {
    transactionHash?: string;
    logIndex?: number | bigint;
    sourceKey?: string;
  },
): string {
  const tx = job.transactionHash ?? '';
  const logIndex = job.logIndex === undefined ? '' : job.logIndex.toString();
  const suffix = job.sourceKey === undefined ? '' : `:${job.sourceKey}`;
  return `${job.chainId.toString()}:${job.blockHash}:${tx}:${logIndex}:${job.type}${suffix}`;
}
