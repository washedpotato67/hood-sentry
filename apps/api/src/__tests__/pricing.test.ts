import type {
  MarketCandle,
  MarketMetrics,
  MarketWindow,
  PriceObservation,
  PriceSourceConfig,
} from '@hood-sentry/market-engine';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PricingReadRepository, pricingRoutes } from '../routes/pricing.js';

const TOKEN = '0x3000000000000000000000000000000000000001' as const;
const QUOTE = '0x3000000000000000000000000000000000000002' as const;
const SOURCE = '0x1000000000000000000000000000000000000001' as const;
const HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

const current: PriceObservation = {
  observationKey: 'fixture:100',
  chainId: 4663,
  tokenAddress: TOKEN,
  quoteAssetAddress: QUOTE,
  sourceKey: 'verified-fixture',
  sourceType: 'directDex',
  sourceContractAddress: SOURCE,
  priceRaw: 2_000_000n,
  priceDecimals: 6,
  sourceBlockNumber: 100n,
  sourceBlockHash: HASH,
  sourceTimestamp: '2026-07-14T12:00:00.000Z',
  observedAt: '2026-07-14T12:00:10.000Z',
  liquidityDepthRaw: 10_000_000n,
  liquidityDepthDecimals: 6,
  priceImpactBps: 100n,
  singleTransactionVolumeBps: 100n,
  providerName: null,
  poolAddress: SOURCE,
  route: [],
  confidenceBps: 9_000n,
  stale: false,
  status: 'available',
  authoritative: true,
  canonical: true,
  methodologyVersion: 'pricing-v1',
  reasons: [],
};

class ReadRepository implements PricingReadRepository {
  constructor(
    private readonly hasPrice = true,
    private readonly hasOracle = false,
    private readonly oracleOverrides: Partial<PriceObservation> = {},
  ) {}

  async getCurrentPrice(): Promise<PriceObservation | null> {
    return this.hasPrice ? current : null;
  }

  async getPriceHistory(): Promise<readonly PriceObservation[]> {
    return this.hasPrice ? [current] : [];
  }

  async getCandles(
    _chainId: number,
    _tokenAddress: string,
    _quoteAssetAddress: string,
    _window: MarketWindow,
    _limit: number,
  ): Promise<readonly MarketCandle[]> {
    return [];
  }

  async getLatestMetrics(): Promise<MarketMetrics | null> {
    return null;
  }

  async listSourceConfigs(): Promise<readonly PriceSourceConfig[]> {
    return this.hasOracle
      ? [
          {
            sourceKey: 'chainlink-fixture',
            sourceType: 'chainlink',
            assetClass: 'erc20',
            chainId: 4663,
            sourceContractAddress: SOURCE,
            sourceAssetAddress: TOKEN,
            quoteAssetAddress: QUOTE,
            verificationSourceUrl: 'https://docs.chain.link/',
            verifiedAt: '2026-07-14T12:00:00.000Z',
            minimumLiquidityRaw: 0n,
            liquidityDecimals: 0,
            maximumStalenessSeconds: 3600,
            enabled: true,
            priority: 1,
            confidenceRules: {
              baseConfidenceBps: 9_000n,
              thinLiquidityPenaltyBps: 0n,
              stalePenaltyBps: 0n,
              disagreementThresholdBps: 0n,
              disagreementPenaltyBps: 0n,
              maximumPriceImpactBps: 0n,
              maximumSingleTransactionVolumeBps: 0n,
              maximumPriceJumpBps: 0n,
              stablecoinDepegThresholdBps: 0n,
              minimumAuthoritativeConfidenceBps: 7_000n,
            },
            route: [],
            methodologyVersion: 'chainlink-v1',
            oracleHeartbeatSeconds: 3600,
            sequencerFeedAddress: null,
          },
        ]
      : [];
  }

  async findLatestOracleStatus(): Promise<PriceObservation | null> {
    if (!this.hasOracle) return null;
    return {
      ...current,
      sourceKey: 'chainlink-fixture',
      sourceType: 'chainlink',
      priceRaw: 123_456_789n,
      priceDecimals: 8,
      roundId: 100n,
      answeredInRound: 100n,
      oraclePaused: false,
      sequencerUp: true,
      reasons: [],
      methodologyVersion: 'chainlink-v1',
      ...this.oracleOverrides,
    };
  }
}

describe('pricing read routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns exact integer price provenance and freshness', async () => {
    await app.register(pricingRoutes, { prefix: '/v1', repository: new ReadRepository() });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tokens/${TOKEN}/price?chainId=4663&quoteAssetAddress=${QUOTE}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        priceRaw: '2000000',
        priceDecimals: 6,
        source: 'verified-fixture',
        sourceBlockNumber: '100',
        sourceTimestamp: '2026-07-14T12:00:00.000Z',
        freshnessSeconds: '10',
      },
    });
  });

  it('returns unavailable instead of zero for an unknown price', async () => {
    await app.register(pricingRoutes, {
      prefix: '/v1',
      repository: new ReadRepository(false),
    });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tokens/${TOKEN}/price?chainId=4663&quoteAssetAddress=${QUOTE}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { priceRaw: null, status: 'unavailable', source: 'unavailable' },
    });
  });

  it('validates candle windows and history dates', async () => {
    await app.register(pricingRoutes, { prefix: '/v1', repository: new ReadRepository() });
    const invalidWindow = await app.inject({
      method: 'GET',
      url: `/v1/tokens/${TOKEN}/candles?chainId=4663&quoteAssetAddress=${QUOTE}&window=2h`,
    });
    expect(invalidWindow.statusCode).toBe(500);
  });

  it('returns oracle source status when no observation exists', async () => {
    await app.register(pricingRoutes, { prefix: '/v1', repository: new ReadRepository(false) });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tokens/${TOKEN}/price/source-status?chainId=4663&quoteAssetAddress=${QUOTE}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        sourceKey: null,
        status: 'unavailable',
        reasons: ['NO_ORACLE_OBSERVATION'],
      },
    });
  });

  it('returns oracle source status with round metadata', async () => {
    await app.register(pricingRoutes, {
      prefix: '/v1',
      repository: new ReadRepository(true, true),
    });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tokens/${TOKEN}/price/source-status?chainId=4663&quoteAssetAddress=${QUOTE}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        sourceKey: 'chainlink-fixture',
        sourceType: 'chainlink',
        answerRaw: '123456789',
        decimals: 8,
        roundId: '100',
        answeredInRound: '100',
        sequencerUp: true,
        oraclePaused: false,
        status: 'available',
      },
    });
  });

  it('returns sequencer-down in oracle source status', async () => {
    await app.register(pricingRoutes, {
      prefix: '/v1',
      repository: new ReadRepository(true, true, {
        sequencerUp: false,
        status: 'unavailable',
        reasons: ['SEQUENCER_DOWN'],
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tokens/${TOKEN}/price/source-status?chainId=4663&quoteAssetAddress=${QUOTE}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        sourceKey: 'chainlink-fixture',
        sequencerUp: false,
        status: 'unavailable',
        reasons: ['SEQUENCER_DOWN'],
      },
    });
  });

  it('returns stale observation in oracle source status', async () => {
    await app.register(pricingRoutes, {
      prefix: '/v1',
      repository: new ReadRepository(true, true, {
        stale: true,
        status: 'lowConfidence',
        reasons: ['STALE_OBSERVATION'],
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/tokens/${TOKEN}/price/source-status?chainId=4663&quoteAssetAddress=${QUOTE}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        sourceKey: 'chainlink-fixture',
        status: 'lowConfidence',
        reasons: ['STALE_OBSERVATION'],
      },
    });
  });
});
