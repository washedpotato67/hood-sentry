import type { NormalizedLiquidityEvent } from '@hood-sentry/chain';
import type { DerivedJob } from '../types.js';

export function liquidityDerivedJobs(event: NormalizedLiquidityEvent): readonly DerivedJob[] {
  const shared = {
    chainId: BigInt(event.chainId),
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
  };
  const data = {
    protocolKey: event.protocolKey,
    protocolVersion: event.protocolVersion,
    poolAddress: event.poolAddress,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    eventType: event.eventType,
  };
  return [
    { type: 'source-reconciliation', ...shared, data },
    { type: 'liquidity-metric', ...shared, data },
    { type: 'alert-evaluation', ...shared, data },
  ];
}
