import type { DerivedJobInput, DerivedJobPayload } from './types.js';

/** Recursively convert bigint values to decimal strings so the value is JSON-safe. */
export function serializeBigints(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigints);
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      result[key] = serializeBigints(inner);
    }
    return result;
  }
  return value;
}

/** Convert an indexer derived job into the JSON-safe payload stored in Redis. */
export function toPayload(job: DerivedJobInput): DerivedJobPayload {
  return {
    type: job.type,
    chainId: job.chainId.toString(),
    blockNumber: job.blockNumber.toString(),
    blockHash: job.blockHash,
    data: serializeBigints(job.data) as Record<string, unknown>,
  };
}
