import { createHash } from 'node:crypto';

/**
 * BullMQ job ids cannot contain ':', but derived-job idempotency keys are
 * colon-delimited (chainId:blockHash:txHash:logIndex:type). Hash the key into a
 * stable, collision-resistant id that is safe as a BullMQ jobId. The same
 * idempotency key always maps to the same id, preserving deduplication.
 */
export function jobIdFromKey(idempotencyKey: string): string {
  return createHash('sha1').update(idempotencyKey).digest('hex');
}
