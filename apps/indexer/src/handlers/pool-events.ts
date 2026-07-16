import type { NormalizedPool } from '@hood-sentry/chain';
import type { DerivedJob } from '../types.js';

export function poolInitializationJobs(pool: NormalizedPool): readonly DerivedJob[] {
  const shared = {
    chainId: BigInt(pool.chainId),
    blockNumber: pool.createdBlockNumber,
    blockHash: pool.createdBlockHash,
  };
  const identity = {
    protocolKey: pool.protocolKey,
    protocolVersion: pool.protocolVersion,
    poolAddress: pool.poolAddress,
    token0Address: pool.token0Address,
    token1Address: pool.token1Address,
    transactionHash: pool.creationTransactionHash,
    logIndex: pool.creationLogIndex,
  };
  return [
    { type: 'pool-refresh', ...shared, data: identity },
    {
      type: 'token-metadata',
      ...shared,
      data: { ...identity, tokenAddress: pool.token0Address },
    },
    {
      type: 'token-metadata',
      ...shared,
      data: { ...identity, tokenAddress: pool.token1Address },
    },
    { type: 'risk-analysis', ...shared, data: identity },
  ];
}
