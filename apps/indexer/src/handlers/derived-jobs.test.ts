import type { NormalizedLiquidityEvent, NormalizedPool } from '@hood-sentry/chain';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { liquidityDerivedJobs } from './liquidity-events.js';
import { poolInitializationJobs } from './pool-events.js';

const POOL = getAddress('0x1000000000000000000000000000000000000001');
const TOKEN0 = getAddress('0x2000000000000000000000000000000000000001');
const TOKEN1 = getAddress('0x2000000000000000000000000000000000000002');
const HASH = `0x${'a'.repeat(64)}` as const;
const TX = `0x${'b'.repeat(64)}` as const;

const pool: NormalizedPool = {
  chainId: 4663,
  protocolKey: 'fixture',
  protocolVersion: '1.0.0',
  poolAddress: POOL,
  factoryAddress: getAddress('0x3000000000000000000000000000000000000001'),
  token0Address: TOKEN0,
  token1Address: TOKEN1,
  poolType: 'constantProduct',
  createdBlockNumber: 100n,
  createdBlockHash: HASH,
  creationTransactionHash: TX,
  creationLogIndex: 1,
  canonical: true,
};

function liquidity(eventType: NormalizedLiquidityEvent['eventType']): NormalizedLiquidityEvent {
  return {
    chainId: 4663,
    protocolKey: 'fixture',
    protocolVersion: '1.0.0',
    eventType,
    poolAddress: POOL,
    providerAddress: getAddress('0x4000000000000000000000000000000000000001'),
    token0Address: TOKEN0,
    token1Address: TOKEN1,
    amount0Raw: 100n,
    amount1Raw: 200n,
    blockNumber: 101n,
    blockHash: HASH,
    transactionHash: TX,
    logIndex: 2,
    canonical: true,
  };
}

describe('risk derived-job production', () => {
  it('includes both pool assets in the pool risk payload', () => {
    const risk = poolInitializationJobs(pool).find((job) => job.type === 'risk-analysis');
    expect(risk?.data).toMatchObject({
      poolAddress: POOL,
      token0Address: TOKEN0,
      token1Address: TOKEN1,
    });
  });

  it('requests a risk rescan after liquidity removal', () => {
    const jobs = liquidityDerivedJobs(liquidity('liquidityRemoved'));
    expect(jobs.map((job) => job.type)).toContain('risk-analysis');
  });

  it('does not request a risk rescan for an addition-only event', () => {
    const jobs = liquidityDerivedJobs(liquidity('liquidityAdded'));
    expect(jobs.map((job) => job.type)).not.toContain('risk-analysis');
  });
});
