import type { DerivedJobPayload } from '@hood-sentry/queue';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';
import type { DiscoveryRefreshJob } from '../jobs/discovery-refresh.js';

const discoveryRefreshData = z.object({
  tokenAddress: z
    .string()
    .refine(isAddress, 'expected a 20-byte address')
    .transform((address) => getAddress(address)),
});

export async function processDiscoveryRefresh(
  payload: DerivedJobPayload,
  context: { discoveryRefresh: Pick<DiscoveryRefreshJob, 'run'> },
): Promise<void> {
  const data = discoveryRefreshData.parse(payload.data);
  await context.discoveryRefresh.run({
    chainId: Number(payload.chainId),
    tokenAddress: data.tokenAddress,
    sourceBlockNumber: BigInt(payload.blockNumber),
  });
}
