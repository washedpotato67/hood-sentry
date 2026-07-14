import type { NormalizedSwap } from '@hood-sentry/chain';
import type { DerivedJob } from '../types.js';

export function swapDerivedJobs(swap: NormalizedSwap): readonly DerivedJob[] {
  const shared = {
    chainId: BigInt(swap.chainId),
    blockNumber: swap.blockNumber,
    blockHash: swap.blockHash,
  };
  const data = {
    protocolKey: swap.protocolKey,
    protocolVersion: swap.protocolVersion,
    poolAddress: swap.poolAddress,
    transactionHash: swap.transactionHash,
    logIndex: swap.logIndex,
  };
  return [
    { type: 'new-price-observation', ...shared, data },
    { type: 'market-metric', ...shared, data },
    { type: 'wallet-activity', ...shared, data },
    { type: 'alert-evaluation', ...shared, data },
  ];
}
