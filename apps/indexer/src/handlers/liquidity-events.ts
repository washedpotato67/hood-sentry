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
    token0Address: event.token0Address,
    token1Address: event.token1Address,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    eventType: event.eventType,
  };
  const jobs: DerivedJob[] = [
    { type: 'pool-refresh', ...shared, data },
    { type: 'source-reconciliation', ...shared, data },
    { type: 'liquidity-metric', ...shared, data },
    { type: 'alert-evaluation', ...shared, data },
  ];
  if (['liquidityRemoved', 'lpBurned', 'positionDecreased'].includes(event.eventType)) {
    jobs.push({ type: 'risk-analysis', ...shared, data });
  }
  return jobs;
}
