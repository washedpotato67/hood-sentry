import type {
  MarketMetrics,
  PriceEvidence,
  PriceObservation,
  PriceSourceConfig,
} from '@hood-sentry/market-engine';
import { describe, expect, it } from 'vitest';
import { BondingCurveMigrationTransitionJob } from './bonding-curve-transition.js';
import { HistoricalRecomputationJob } from './historical-recomputation.js';
import { MarketMetricAggregationJob } from './market-metric-aggregation.js';
import { NewPriceObservationJob } from './price-observation.js';
import { PricingReorgJob } from './pricing-reorg.js';
import { StaleSourceCleanupJob } from './stale-source-cleanup.js';

const TOKEN = '0x3000000000000000000000000000000000000001' as const;
const QUOTE = '0x3000000000000000000000000000000000000002' as const;
const SOURCE = '0x1000000000000000000000000000000000000001' as const;
const POOL = '0x2000000000000000000000000000000000000001' as const;
const HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

const config: PriceSourceConfig = {
  sourceKey: 'fixture',
  sourceType: 'directDex',
  assetClass: 'erc20',
  chainId: 4663,
  sourceContractAddress: SOURCE,
  sourceAssetAddress: TOKEN,
  quoteAssetAddress: QUOTE,
  verificationSourceUrl: 'https://example.com/verified',
  verifiedAt: '2026-07-14T00:00:00.000Z',
  minimumLiquidityRaw: 1_000n,
  liquidityDecimals: 6,
  maximumStalenessSeconds: 60,
  enabled: true,
  priority: 1,
  confidenceRules: {
    baseConfidenceBps: 9_500n,
    thinLiquidityPenaltyBps: 3_000n,
    stalePenaltyBps: 3_000n,
    disagreementThresholdBps: 500n,
    disagreementPenaltyBps: 2_000n,
    maximumPriceImpactBps: 1_000n,
    maximumSingleTransactionVolumeBps: 5_000n,
    maximumPriceJumpBps: 5_000n,
    stablecoinDepegThresholdBps: 300n,
    minimumAuthoritativeConfidenceBps: 8_000n,
  },
  route: [],
  methodologyVersion: 'pricing-v1',
};

const evidence: PriceEvidence = {
  priceRaw: 2_000_000n,
  priceDecimals: 6,
  sourceBlockNumber: 100n,
  sourceBlockHash: HASH,
  sourceTimestamp: '2026-07-14T12:00:00.000Z',
  observedAt: '2026-07-14T12:00:10.000Z',
  liquidityDepthRaw: 10_000n,
  liquidityDepthDecimals: 6,
  priceImpactBps: 100n,
  singleTransactionVolumeBps: 100n,
  providerName: null,
  poolAddress: POOL,
  route: [],
  canonical: true,
  reasons: [],
};

describe('pricing worker jobs', () => {
  it('persists new observations with a stable idempotency key', async () => {
    const saved: PriceObservation[] = [];
    const job = new NewPriceObservationJob({
      async saveObservation(value) {
        saved.push(value);
      },
    });
    const first = await job.run({ config, evidence });
    const second = await job.run({ config, evidence });
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(saved.at(-1)?.priceRaw).toBe(2_000_000n);
  });

  it('marks stale observations idempotently by cutoff', async () => {
    const job = new StaleSourceCleanupJob({
      async markStaleSources() {
        return 2;
      },
    });
    const first = await job.run({ observedBefore: '2026-07-14T12:00:00.000Z' });
    const second = await job.run({ observedBefore: '2026-07-14T12:00:00.000Z' });
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it('does not enable an unverified migration pool', async () => {
    let curveDisabled = false;
    const job = new BondingCurveMigrationTransitionJob({
      async disableCurveSource() {
        curveDisabled = true;
      },
      async enableMigratedPoolSource() {
        return true;
      },
    });
    const result = await job.run({
      chainId: 4663,
      tokenAddress: TOKEN,
      destinationPoolAddress: POOL,
      migrationBlock: 100n,
      destinationPoolVerified: false,
    });
    expect(curveDisabled).toBe(true);
    expect(result.dexSourceEnabled).toBe(false);
  });

  it('invalidates reorged prices before publishing recomputation', async () => {
    const order: string[] = [];
    const job = new PricingReorgJob(
      {
        async markPricingNonCanonical() {
          order.push('invalidate');
        },
      },
      {
        async publishRecompute() {
          order.push('recompute');
        },
      },
    );
    await job.run({ chainId: 4663, fromBlock: 100n, toBlock: 101n });
    expect(order).toEqual(['invalidate', 'recompute']);
  });

  it('rejects an inverted historical range', async () => {
    const job = new HistoricalRecomputationJob({ async recompute() {} });
    await expect(
      job.run({
        chainId: 4663,
        tokenAddress: TOKEN,
        fromBlock: 2n,
        toBlock: 1n,
        windows: ['1m'],
        methodologyVersion: 'metrics-v1',
      }),
    ).rejects.toThrow('range');
  });

  it('persists metrics with null market cap when supply is unreliable', async () => {
    const saved: MarketMetrics[] = [];
    const job = new MarketMetricAggregationJob({
      async saveMetrics(value) {
        saved.push(value);
      },
    });
    const result = await job.run({
      chainId: 4663,
      tokenAddress: TOKEN,
      quoteAssetAddress: QUOTE,
      window: '1m',
      asOf: evidence.observedAt,
      quoteDecimals: 6,
      observation: null,
      trades: [],
      supply: {
        totalSupplyRaw: null,
        circulatingSupplyRaw: null,
        supplyDecimals: 18,
        circulatingSupplyReliable: false,
        circulatingSupplyMethodology: null,
        circulatingSupplyExclusions: [],
      },
      context: {
        liquidityRaw: null,
        liquidityDecimals: null,
        previousClosePriceRaw: null,
        previousVolumeRaw: null,
        previousLiquidityRaw: null,
        holderCount: null,
        previousHolderCount: null,
        previousTransactionCount: null,
        priceImpactByOrderSize: {},
      },
      methodologyVersion: 'metrics-v1',
    });
    expect(result.metrics.marketCapitalizationRaw).toBeNull();
    expect(saved.at(-1)?.marketCapitalizationRaw).toBeNull();
  });
});
