import type { DerivedJobPayload } from '@hood-sentry/queue';
import { getAddress, isAddress, isHash } from 'viem';
import { z } from 'zod';
import type { PoolRefreshJob } from '../jobs/pool-refresh.js';

const poolRefreshData = z.object({
  protocolKey: z.string().trim().min(1),
  protocolVersion: z.string().trim().min(1),
  poolAddress: z
    .string()
    .refine(isAddress, 'expected a 20-byte address')
    .transform((address) => getAddress(address)),
});

export async function processPoolRefresh(
  payload: DerivedJobPayload,
  context: { poolRefresh: Pick<PoolRefreshJob, 'run'> },
): Promise<void> {
  const data = poolRefreshData.parse(payload.data);
  if (!isHash(payload.blockHash)) throw new Error('Pool refresh block hash is invalid');
  await context.poolRefresh.run({
    chainId: Number(payload.chainId),
    protocolKey: data.protocolKey,
    protocolVersion: data.protocolVersion,
    poolAddress: data.poolAddress,
    blockNumber: BigInt(payload.blockNumber),
    blockHash: payload.blockHash,
  });
}
