/** A derived job as produced by the indexer, before serialization. */
export interface DerivedJobInput {
  type: string;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: string;
  data: Record<string, unknown>;
}

/** The JSON-safe shape stored in Redis (bigints rendered as decimal strings). */
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
export function derivedJobIdempotencyKey(
  job: Pick<DerivedJobInput, 'type' | 'chainId' | 'blockHash'> & {
    transactionHash?: string;
    logIndex?: number | bigint;
  },
): string {
  const tx = job.transactionHash ?? '';
  const logIndex = job.logIndex === undefined ? '' : job.logIndex.toString();
  return `${job.chainId.toString()}:${job.blockHash}:${tx}:${logIndex}:${job.type}`;
}
