import { describe, expect, it } from 'vitest';
import {
  ExternalMarketDataClient,
  FixedWindowRateLimiter,
  PriceSourceActivationService,
  aggregateCandle,
  aggregateMarketMetrics,
  bondingCurveEvidence,
  chainlinkEvidence,
  detectOutliers,
  evaluateObservation,
  externalEvidence,
  median,
  poolEvidence,
  poolPriceRaw,
  selectPriceSource,
  validateSourceRegistry,
} from '../index.js';
import type {
  ConfidenceRules,
  MetricContext,
  PriceEvidence,
  PriceObservation,
  PriceSourceConfig,
  SupplyInput,
  TradeMetricInput,
} from '../types.js';

const TOKEN = '0x3000000000000000000000000000000000000001' as const;
const QUOTE = '0x3000000000000000000000000000000000000002' as const;
const POOL = '0x2000000000000000000000000000000000000001' as const;
const SOURCE = '0x1000000000000000000000000000000000000001' as const;
const TRADER = '0x4000000000000000000000000000000000000001' as const;
const HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

const rules: ConfidenceRules = {
  baseConfidenceBps: 9_500n,
  thinLiquidityPenaltyBps: 4_000n,
  stalePenaltyBps: 4_000n,
  disagreementThresholdBps: 500n,
  disagreementPenaltyBps: 2_000n,
  maximumPriceImpactBps: 1_000n,
  maximumSingleTransactionVolumeBps: 5_000n,
  maximumPriceJumpBps: 5_000n,
  stablecoinDepegThresholdBps: 300n,
  minimumAuthoritativeConfidenceBps: 8_000n,
};

function config(overrides: Partial<PriceSourceConfig> = {}): PriceSourceConfig {
  return {
    sourceKey: 'fixture-source',
    sourceType: 'directDex',
    assetClass: 'erc20',
    chainId: 4663,
    sourceContractAddress: SOURCE,
    sourceAssetAddress: TOKEN,
    quoteAssetAddress: QUOTE,
    verificationSourceUrl: 'https://example.com/verified',
    verifiedAt: '2026-07-14T00:00:00.000Z',
    minimumLiquidityRaw: 1_000_000n,
    liquidityDecimals: 6,
    maximumStalenessSeconds: 60,
    enabled: true,
    priority: 1,
    confidenceRules: rules,
    route: [],
    methodologyVersion: 'pricing-v1',
    ...overrides,
  };
}

function evidence(overrides: Partial<PriceEvidence> = {}): PriceEvidence {
  return {
    priceRaw: 2_000_000n,
    priceDecimals: 6,
    sourceBlockNumber: 100n,
    sourceBlockHash: HASH,
    sourceTimestamp: '2026-07-14T12:00:00.000Z',
    observedAt: '2026-07-14T12:00:30.000Z',
    liquidityDepthRaw: 10_000_000n,
    liquidityDepthDecimals: 6,
    priceImpactBps: 100n,
    singleTransactionVolumeBps: 100n,
    providerName: null,
    poolAddress: POOL,
    route: [],
    canonical: true,
    reasons: [],
    ...overrides,
  };
}

function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    ...evaluateObservation(config(), evidence()),
    ...overrides,
  };
}

describe('deterministic pricing', () => {
  it('prices an 18-decimal token against a 6-decimal stablecoin', () => {
    expect(
      poolPriceRaw(
        {
          tokenAddress: TOKEN,
          quoteAssetAddress: QUOTE,
          tokenDecimals: 18,
          quoteDecimals: 6,
          reserveTokenRaw: 5n * 10n ** 18n,
          reserveQuoteRaw: 10n * 10n ** 6n,
          protocolVerified: true,
          tokenAddressesVerified: true,
          poolStateFresh: true,
          priceImpactBps: 0n,
          singleTransactionVolumeBps: 0n,
        },
        18,
      ),
    ).toBe(2n * 10n ** 18n);
  });

  it('handles different quote decimals and deterministic integer rounding', () => {
    const input = {
      tokenAddress: TOKEN,
      quoteAssetAddress: QUOTE,
      tokenDecimals: 18,
      quoteDecimals: 6,
      reserveTokenRaw: 3n * 10n ** 18n,
      reserveQuoteRaw: 10n * 10n ** 6n,
      protocolVerified: true,
      tokenAddressesVerified: true,
      poolStateFresh: true,
      priceImpactBps: 0n,
      singleTransactionVolumeBps: 0n,
    } as const;
    expect(poolPriceRaw(input, 6)).toBe(3_333_333n);
  });

  it('handles large bigint values without precision loss', () => {
    const huge = 10n ** 60n;
    expect(
      poolPriceRaw(
        {
          tokenAddress: TOKEN,
          quoteAssetAddress: QUOTE,
          tokenDecimals: 18,
          quoteDecimals: 18,
          reserveTokenRaw: huge,
          reserveQuoteRaw: huge * 7n,
          protocolVerified: true,
          tokenAddressesVerified: true,
          poolStateFresh: true,
          priceImpactBps: 0n,
          singleTransactionVolumeBps: 0n,
        },
        18,
      ),
    ).toBe(7n * 10n ** 18n);
  });

  it('prevents a thin pool from becoming authoritative', () => {
    const base = evidence({ liquidityDepthRaw: 10n });
    const result = evaluateObservation(
      config(),
      poolEvidence(
        {
          tokenAddress: TOKEN,
          quoteAssetAddress: QUOTE,
          tokenDecimals: 18,
          quoteDecimals: 6,
          reserveTokenRaw: 10n ** 18n,
          reserveQuoteRaw: 2n * 10n ** 6n,
          protocolVerified: true,
          tokenAddressesVerified: true,
          poolStateFresh: true,
          priceImpactBps: 100n,
          singleTransactionVolumeBps: 100n,
        },
        6,
        {
          sourceBlockNumber: base.sourceBlockNumber,
          sourceBlockHash: base.sourceBlockHash,
          sourceTimestamp: base.sourceTimestamp,
          observedAt: base.observedAt,
          liquidityDepthRaw: base.liquidityDepthRaw,
          liquidityDepthDecimals: base.liquidityDepthDecimals,
          priceImpactBps: base.priceImpactBps,
          singleTransactionVolumeBps: base.singleTransactionVolumeBps,
          providerName: base.providerName,
          poolAddress: base.poolAddress,
          route: base.route,
          canonical: base.canonical,
        },
      ),
    );
    expect(result.status).toBe('lowConfidence');
    expect(result.authoritative).toBe(false);
    expect(result.reasons).toContain('THIN_LIQUIDITY');
  });

  it('rejects stale Chainlink data and negative or zero answers', () => {
    const base = {
      sourceBlockNumber: 100n,
      sourceBlockHash: HASH,
      sourceTimestamp: '2026-07-14T11:00:00.000Z',
      observedAt: '2026-07-14T12:00:00.000Z',
      liquidityDepthRaw: null,
      liquidityDepthDecimals: null,
      priceImpactBps: null,
      singleTransactionVolumeBps: null,
      providerName: null,
      poolAddress: null,
      route: [],
      canonical: true,
    } as const;
    for (const answer of [-1n, 0n]) {
      const value = chainlinkEvidence(
        {
          answer,
          decimals: 8,
          roundId: 2n,
          answeredInRound: 2n,
          updatedAt: '2026-07-14T11:00:00.000Z',
          sequencerUp: true,
          sequencerGracePeriodElapsed: true,
          oraclePaused: false,
        },
        base,
      );
      expect(evaluateObservation(config({ sourceType: 'chainlink' }), value).status).toBe(
        'unavailable',
      );
    }
    const stale = evaluateObservation(
      config({ sourceType: 'chainlink' }),
      evidence({ sourceTimestamp: '2026-07-14T11:00:00.000Z' }),
    );
    expect(stale.stale).toBe(true);
    expect(stale.authoritative).toBe(false);
  });

  it('preserves a Stock Token Chainlink answer without applying a UI multiplier', () => {
    const value = chainlinkEvidence(
      {
        answer: 12_345_678_900n,
        decimals: 8,
        roundId: 2n,
        answeredInRound: 2n,
        updatedAt: '2026-07-14T12:00:00.000Z',
        sequencerUp: true,
        sequencerGracePeriodElapsed: true,
        oraclePaused: false,
      },
      {
        sourceBlockNumber: 100n,
        sourceBlockHash: HASH,
        sourceTimestamp: '2026-07-14T12:00:00.000Z',
        observedAt: '2026-07-14T12:00:10.000Z',
        liquidityDepthRaw: null,
        liquidityDepthDecimals: null,
        priceImpactBps: null,
        singleTransactionVolumeBps: null,
        providerName: null,
        poolAddress: null,
        route: [],
        canonical: true,
      },
    );
    const result = evaluateObservation(
      config({ sourceType: 'chainlink', assetClass: 'stockToken' }),
      value,
    );
    expect(result.priceRaw).toBe(12_345_678_900n);
  });

  it('uses a verified bonding curve before migration and stops after migration', () => {
    const base = {
      sourceBlockNumber: 100n,
      sourceBlockHash: HASH,
      sourceTimestamp: '2026-07-14T12:00:00.000Z',
      observedAt: '2026-07-14T12:00:10.000Z',
      liquidityDepthRaw: 2_000_000n,
      liquidityDepthDecimals: 6,
      priceImpactBps: null,
      singleTransactionVolumeBps: null,
      providerName: null,
      poolAddress: null,
      route: [],
      canonical: true,
    } as const;
    const curve = {
      numeratorRaw: 3n,
      denominatorRaw: 2n,
      priceDecimals: 6,
      formulaKey: 'fixture-linear-v1',
      formulaParametersHash: HASH,
      contractVerified: true,
      supplyStateVerified: true,
      graduated: false,
      migrated: false,
    } as const;
    expect(bondingCurveEvidence(curve, base).priceRaw).toBe(1_500_000n);
    expect(bondingCurveEvidence({ ...curve, migrated: true }, base).priceRaw).toBeNull();
  });

  it('selects the migrated DEX source after a bonding curve becomes unavailable', () => {
    const curve = observation({
      sourceKey: 'curve',
      sourceType: 'launchpadBondingCurve',
      priceRaw: null,
      status: 'unavailable',
      authoritative: false,
    });
    const dex = observation({ sourceKey: 'dex', sourceType: 'directDex' });
    const result = selectPriceSource(
      [
        config({ sourceKey: 'curve', sourceType: 'launchpadBondingCurve', priority: 1 }),
        config({ sourceKey: 'dex', priority: 2 }),
      ],
      [curve, dex],
      '2026-07-14T12:00:30.000Z',
    );
    expect(result.selected.sourceKey).toBe('dex');
  });

  it('penalizes source disagreement without replacing observed data', () => {
    const primary = observation({ sourceKey: 'primary', priceRaw: 1_000_000n });
    const secondary = observation({ sourceKey: 'secondary', priceRaw: 2_000_000n });
    const result = selectPriceSource(
      [
        config({ sourceKey: 'primary', priority: 1 }),
        config({ sourceKey: 'secondary', priority: 2 }),
      ],
      [primary, secondary],
      primary.observedAt,
    );
    expect(result.selected.priceRaw).toBe(1_000_000n);
    expect(result.selected.status).toBe('lowConfidence');
    expect(result.disagreementWarnings[0]).toContain('SOURCE_DISAGREEMENT');
  });

  it('detects stablecoin depeg, flash volume, and one-wallet wash volume', () => {
    const result = detectOutliers({
      observation: observation({ priceRaw: 900_000n }),
      previousPriceRaw: 1_000_000n,
      stablecoinTargetRaw: 1_000_000n,
      windowVolumeRaw: 1_000_000n,
      previousWindowVolumeRaw: 10_000n,
      walletVolumeRaw: 900_000n,
      postGraduationDexPriceRaw: null,
    });
    expect(result.reasons).toEqual(
      expect.arrayContaining(['STABLECOIN_DEPEG', 'FLASH_VOLUME_SPIKE', 'ONE_WALLET_WASH_VOLUME']),
    );
  });

  it('uses configured stablecoin depeg tolerance during source evaluation', () => {
    const result = evaluateObservation(
      config({ assetClass: 'stablecoin' }),
      evidence({ priceRaw: 900_000n }),
    );
    expect(result.reasons).toContain('STABLECOIN_DEPEG');
    expect(result.authoritative).toBe(false);
  });

  it('returns an explicit unavailable observation when every source fails', () => {
    const result = selectPriceSource(
      [config()],
      [observation({ priceRaw: null, status: 'unavailable', authoritative: false })],
      '2026-07-14T12:00:30.000Z',
    );
    expect(result.selected).toMatchObject({
      priceRaw: null,
      status: 'unavailable',
      sourceType: 'unavailable',
    });
  });

  it('attributes external provider observations and rejects malformed decimals', () => {
    const base = evidence();
    const external = externalEvidence(
      {
        priceRaw: 1_000_000n,
        priceDecimals: 6,
        providerName: 'fixture-provider',
        providerTimestamp: base.sourceTimestamp,
      },
      {
        sourceBlockNumber: null,
        sourceBlockHash: null,
        observedAt: base.observedAt,
        liquidityDepthRaw: null,
        liquidityDepthDecimals: null,
        priceImpactBps: null,
        singleTransactionVolumeBps: null,
        poolAddress: null,
        route: [],
        canonical: true,
      },
    );
    expect(external.providerName).toBe('fixture-provider');
    expect(
      externalEvidence(
        {
          priceRaw: 1n,
          priceDecimals: 300,
          providerName: 'fixture-provider',
          providerTimestamp: base.sourceTimestamp,
        },
        {
          sourceBlockNumber: null,
          sourceBlockHash: null,
          observedAt: base.observedAt,
          liquidityDepthRaw: null,
          liquidityDepthDecimals: null,
          priceImpactBps: null,
          singleTransactionVolumeBps: null,
          poolAddress: null,
          route: [],
          canonical: true,
        },
      ).priceRaw,
    ).toBeNull();
  });

  it('rejects an enabled on-chain source without a verified contract', () => {
    expect(() => validateSourceRegistry([config({ sourceContractAddress: null })])).toThrow(
      'verified contract',
    );
  });

  it('rate limits and validates external provider responses', async () => {
    const client = new ExternalMarketDataClient(
      'fixture-provider',
      {
        async fetchPrice() {
          return {
            priceRaw: '1000000',
            priceDecimals: 6,
            providerTimestamp: '2026-07-14T12:00:00.000Z',
          };
        },
      },
      new FixedWindowRateLimiter(1, 60_000, () => 1_000),
    );
    await expect(
      client.getPrice({ chainId: 4663, tokenAddress: TOKEN, quoteAssetAddress: QUOTE }),
    ).resolves.toMatchObject({ priceRaw: 1_000_000n, providerName: 'fixture-provider' });
    await expect(
      client.getPrice({ chainId: 4663, tokenAddress: TOKEN, quoteAssetAddress: QUOTE }),
    ).rejects.toThrow('RATE_LIMITED');
  });

  it('keeps a source inactive when independent verification fails', async () => {
    const service = new PriceSourceActivationService({
      async verify() {
        return {
          verified: false,
          checkedAt: '2026-07-14T12:00:00.000Z',
          reason: 'BYTECODE_MISMATCH',
        };
      },
    });
    await expect(service.validate([config()])).resolves.toMatchObject([
      { active: false, reason: 'BYTECODE_MISMATCH' },
    ]);
  });
});

describe('reproducible metrics', () => {
  const supply: SupplyInput = {
    totalSupplyRaw: 1_000_000n * 10n ** 18n,
    circulatingSupplyRaw: 500_000n * 10n ** 18n,
    supplyDecimals: 18,
    circulatingSupplyReliable: true,
    circulatingSupplyMethodology: 'total-minus-verified-exclusions-v1',
    circulatingSupplyExclusions: [SOURCE],
  };
  const context: MetricContext = {
    liquidityRaw: 20_000_000n,
    liquidityDecimals: 6,
    previousClosePriceRaw: 1_000_000n,
    previousVolumeRaw: 1_000_000n,
    previousLiquidityRaw: 10_000_000n,
    holderCount: 11n,
    previousHolderCount: 10n,
    previousTransactionCount: 1n,
    priceImpactByOrderSize: { '1000000': 25n },
  };
  const trades: readonly TradeMetricInput[] = [
    {
      transactionHash: HASH,
      traderAddress: TRADER,
      side: 'buy',
      tokenAmountRaw: 10n,
      quoteAmountRaw: 100n,
      timestamp: '2026-07-14T12:00:10.000Z',
      canonical: true,
      whale: false,
    },
    {
      transactionHash: `0x${'b'.repeat(64)}`,
      traderAddress: SOURCE,
      side: 'sell',
      tokenAmountRaw: 20n,
      quoteAmountRaw: 300n,
      timestamp: '2026-07-14T12:00:20.000Z',
      canonical: true,
      whale: true,
    },
  ];

  it('calculates OHLC, buy and sell metrics, median, market cap, and FDV', () => {
    const observations = [
      observation({ priceRaw: 1_000_000n }),
      observation({
        observationKey: 'second',
        priceRaw: 2_000_000n,
        sourceTimestamp: '2026-07-14T12:00:40.000Z',
      }),
    ];
    expect(aggregateCandle(observations, '1m', 'metrics-v1')).toMatchObject({
      openPriceRaw: 1_000_000n,
      highPriceRaw: 2_000_000n,
      closePriceRaw: 2_000_000n,
    });
    const metrics = aggregateMarketMetrics({
      chainId: 4663,
      tokenAddress: TOKEN,
      quoteAssetAddress: QUOTE,
      window: '1m',
      asOf: '2026-07-14T12:00:50.000Z',
      quoteDecimals: 6,
      observation: observations[1] ?? null,
      trades,
      supply,
      context,
      methodologyVersion: 'metrics-v1',
    });
    expect(metrics.volumeRaw).toBe(400n);
    expect(metrics.buyCount).toBe(1n);
    expect(metrics.sellCount).toBe(1n);
    expect(metrics.averageTradeSizeRaw).toBe(200n);
    expect(metrics.medianTradeSizeRaw).toBe(200n);
    expect(metrics.marketCapitalizationRaw).toBe(1_000_000_000_000n);
    expect(metrics.fullyDilutedValuationRaw).toBe(2_000_000_000_000n);
  });

  it('keeps market cap unavailable when circulating supply is unreliable', () => {
    const metrics = aggregateMarketMetrics({
      chainId: 4663,
      tokenAddress: TOKEN,
      quoteAssetAddress: QUOTE,
      window: '24h',
      asOf: '2026-07-14T12:00:50.000Z',
      quoteDecimals: 6,
      observation: observation(),
      trades: [],
      supply: { ...supply, circulatingSupplyReliable: false },
      context,
      methodologyVersion: 'metrics-v1',
    });
    expect(metrics.marketCapitalizationRaw).toBeNull();
    expect(metrics.fullyDilutedValuationRaw).not.toBeNull();
  });

  it('excludes a reorged swap and produces every requested window', () => {
    const reorged = { ...trades[0], canonical: false } as TradeMetricInput;
    for (const window of ['1m', '5m', '15m', '1h', '6h', '24h', '7d', '30d'] as const) {
      const metrics = aggregateMarketMetrics({
        chainId: 4663,
        tokenAddress: TOKEN,
        quoteAssetAddress: QUOTE,
        window,
        asOf: '2026-07-14T12:00:50.000Z',
        quoteDecimals: 6,
        observation: observation(),
        trades: [reorged],
        supply,
        context,
        methodologyVersion: 'metrics-v1',
      });
      expect(metrics.volumeRaw).toBe(0n);
    }
  });

  it('uses integer median rules', () => {
    expect(median([1n, 2n, 100n])).toBe(2n);
    expect(median([1n, 2n])).toBe(1n);
  });
});
