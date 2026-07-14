import { describe, expect, it } from 'vitest';
import {
  type DiscoveryCandidate,
  type DiscoveryTrade,
  applyCanonicalTokenRegistry,
  calculateTrendingScore,
  materializeDiscoveryItem,
  paginate,
  rankFeed,
  rankSponsored,
  searchDiscovery,
} from '../index.js';

const TOKEN_A = '0x0000000000000000000000000000000000000001';
const TOKEN_B = '0x0000000000000000000000000000000000000002';
const WALLET_A = '0x0000000000000000000000000000000000000011';
const WALLET_B = '0x0000000000000000000000000000000000000012';
const BLOCK_HASH = `0x${'1'.repeat(64)}` as const;

function trade(index: number, overrides: Partial<DiscoveryTrade> = {}): DiscoveryTrade {
  return {
    transactionHash: `0x${index.toString(16).padStart(64, '0')}`,
    blockNumber: 100n + BigInt(index),
    blockHash: BLOCK_HASH,
    logIndex: index,
    timestamp: new Date(Date.UTC(2026, 6, 14, 11, 0, index)).toISOString(),
    senderAddress: WALLET_A,
    recipientAddress: WALLET_B,
    traderAddress: WALLET_A,
    counterpartyAddress: WALLET_B,
    side: index % 2 === 0 ? 'buy' : 'sell',
    quoteAmountRaw: 1_000_000_000n,
    canonical: true,
    ...overrides,
  };
}

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    chainId: 46630,
    address: TOKEN_A,
    name: 'Alpha',
    symbol: 'ALPHA',
    decimals: 18,
    tokenType: 'erc20',
    canonicalState: 'unknown',
    canonicalTicker: null,
    stockTokenCategory: null,
    etfCategory: null,
    projectName: null,
    projectSlug: null,
    projectVerified: false,
    projectVerifiedAt: null,
    deployerAddress: WALLET_A,
    primaryPoolAddress: TOKEN_B,
    poolAddresses: [TOKEN_B],
    protocolKey: 'fixture-dex',
    launchpadKey: null,
    quoteAssetAddress: TOKEN_B,
    firstSeenBlockNumber: 80n,
    firstSeenAt: '2026-07-13T11:00:00.000Z',
    poolCreatedBlockNumber: 90n,
    poolCreatedAt: '2026-07-13T12:00:00.000Z',
    priceRaw: 10n ** 18n,
    priceDecimals: 18,
    priceStatus: 'available',
    priceObservedAt: '2026-07-14T11:59:50.000Z',
    liquidityRaw: 2_000_000_000_000n,
    liquidityDecimals: 6,
    volumeRaw: 5_000_000_000_000n,
    volumeDecimals: 6,
    volumeChangeBps: 5_000n,
    liquidityChangeBps: 2_000n,
    holderCount: 2_000n,
    holderGrowth: 200n,
    holderConcentrationBps: 2_500n,
    transactionCount: 2_000n,
    transactionGrowthBps: 4_000n,
    uniqueTraders: 500n,
    watchlistCount: 100n,
    watchlistGrowth: 20n,
    alertCount: 10n,
    alertCreationGrowth: 5n,
    launchpadState: 'none',
    launchpadCurveProgressBps: null,
    graduatedAt: null,
    migratedAt: null,
    riskGrade: 'B',
    riskCompletenessBps: 9_000n,
    suspiciousDeployerEvidence: [],
    duplicateSymbolAddresses: [],
    dataQualityWarnings: [],
    lastScannedAt: '2026-07-14T11:30:00.000Z',
    latestCriticalFindingAt: null,
    sourceBlockNumber: 100n,
    sourceBlockHash: BLOCK_HASH,
    sourceTimestamp: '2026-07-14T11:59:50.000Z',
    observedAt: '2026-07-14T12:00:00.000Z',
    canonical: true,
    recentTrades: [
      trade(1, { traderAddress: WALLET_A, side: 'buy' }),
      trade(2, { traderAddress: WALLET_B, side: 'buy' }),
    ],
    manipulationContext: {
      liquidityRaw: 2_000_000_000_000n,
      minimumHealthyLiquidityRaw: 100_000_000_000n,
      tinyTradeThresholdRaw: 1_000n,
      priceImpactBps: 100n,
      sybilClusterWallets: [],
      launchpad: false,
    },
    ...overrides,
  };
}

describe('deterministic discovery rankings', () => {
  it('ranks organic growth from non-price components', () => {
    const strong = materializeDiscoveryItem(candidate());
    const weak = materializeDiscoveryItem(
      candidate({
        address: TOKEN_B,
        volumeRaw: 1_000_000n,
        uniqueTraders: 2n,
        holderGrowth: 0n,
        transactionGrowthBps: 0n,
      }),
    );
    expect(rankFeed('trending', [weak, strong])[0]?.address).toBe(TOKEN_A);
    expect(strong.trending.components.some((item) => item.key === 'logScaledVolume')).toBe(true);
    expect(strong.trending.components.some((item) => item.key.includes('priceChange'))).toBe(false);
  });

  it('penalizes wash-like rapid loops with evidence', () => {
    const clean = calculateTrendingScore(candidate());
    const wash = calculateTrendingScore(
      candidate({
        recentTrades: Array.from({ length: 8 }, (_, index) => trade(index + 1)),
      }),
    );
    expect(wash.scoreBps).toBeLessThan(clean.scoreBps);
    expect(
      wash.manipulation.signals.find((item) => item.code === 'RAPID_BUY_SELL_LOOP')?.status,
    ).toBe('observed');
  });

  it('penalizes one-wallet volume concentration', () => {
    const score = calculateTrendingScore(
      candidate({ recentTrades: [trade(1), trade(2), trade(3)] }),
    );
    const evidence = score.manipulation.signals.find(
      (item) => item.code === 'ONE_WALLET_VOLUME_CONCENTRATION',
    );
    expect(evidence?.status).toBe('observed');
    expect(evidence?.facts.topWalletVolumeBps).toBe('10000');
  });

  it('penalizes thin liquidity with high impact', () => {
    const score = calculateTrendingScore(
      candidate({
        liquidityRaw: 10n,
        manipulationContext: {
          liquidityRaw: 10n,
          minimumHealthyLiquidityRaw: 1_000_000n,
          tinyTradeThresholdRaw: 1n,
          priceImpactBps: 2_000n,
          sybilClusterWallets: [],
          launchpad: false,
        },
      }),
    );
    expect(
      score.manipulation.signals.find((item) => item.code === 'THIN_POOL_PRICE_MANIPULATION')
        ?.status,
    ).toBe('observed');
    expect(
      score.components.find((item) => item.key === 'lowLiquidityPenalty')?.normalizedBps,
    ).toBeGreaterThan(0n);
  });

  it('orders new and old tokens by indexed time', () => {
    const newer = materializeDiscoveryItem(candidate());
    const older = materializeDiscoveryItem(
      candidate({ address: TOKEN_B, firstSeenAt: '2025-01-01T00:00:00.000Z' }),
    );
    expect(rankFeed('newTokens', [older, newer]).map((item) => item.address)).toEqual([
      TOKEN_A,
      TOKEN_B,
    ]);
  });

  it('shows duplicate ticker addresses in search', () => {
    const item = materializeDiscoveryItem(candidate({ duplicateSymbolAddresses: [TOKEN_B] }));
    const result = searchDiscovery([item], 'ALPHA')[0];
    expect(result?.duplicateSymbolWarning).toBe(true);
    expect(result?.duplicateSymbolAddresses).toEqual([TOKEN_B]);
    expect(result?.item.address).toBe(TOKEN_A);
  });

  it('matches an address without token metadata', () => {
    const item = materializeDiscoveryItem(candidate({ name: null, symbol: null }));
    const result = searchDiscovery([item], TOKEN_A)[0];
    expect(result?.rank).toBe(100_000);
    expect(result?.matchedFields).toContain('address');
  });

  it('matches an indexed wallet address before text metadata', () => {
    const item = materializeDiscoveryItem(candidate());
    const result = searchDiscovery([item], WALLET_B)[0];
    expect(result?.rank).toBe(100_000);
    expect(result?.matchedFields).toContain('walletAddress');
  });

  it('does not classify a fake Stock Token from its ticker', () => {
    const fake = candidate({ symbol: 'AAPL' });
    const classified = applyCanonicalTokenRegistry(fake, [
      {
        chainId: fake.chainId,
        address: TOKEN_B,
        ticker: 'AAPL',
        name: 'Apple Inc.',
        assetType: 'stock',
        category: 'equity',
      },
    ]);
    expect(classified.canonicalState).toBe('unknown');
    expect(classified.tokenType).toBe('erc20');
  });

  it('keeps sponsored placement separate from organic rank', () => {
    const first = materializeDiscoveryItem(candidate());
    const second = materializeDiscoveryItem(candidate({ address: TOKEN_B, volumeRaw: 1n }));
    const organic = rankFeed('trending', [second, first]);
    const sponsored = rankSponsored(
      'trending',
      [
        {
          placementId: '8a4bdac5-4d95-4e0f-8ce2-1ab496a5952f',
          chainId: first.chainId,
          tokenAddress: TOKEN_B,
          feed: 'trending',
          priority: 10,
          startsAt: '2026-07-14T00:00:00.000Z',
          endsAt: '2026-07-15T00:00:00.000Z',
          label: 'Sponsored',
          disclosure: 'Paid placement. No endorsement.',
          createdAt: '2026-07-13T00:00:00.000Z',
          createdBy: 'admin',
        },
      ],
      [first, second],
      '2026-07-14T12:00:00.000Z',
    );
    expect(organic[0]?.address).toBe(TOKEN_A);
    expect(sponsored[0]?.item.address).toBe(TOKEN_B);
    expect(sponsored[0]?.placement.label).toBe('Sponsored');
  });

  it('includes graduated launchpad tokens only in the graduation feed', () => {
    const graduated = materializeDiscoveryItem(
      candidate({ launchpadState: 'graduated', graduatedAt: '2026-07-14T10:00:00.000Z' }),
    );
    const ordinary = materializeDiscoveryItem(candidate({ address: TOKEN_B }));
    expect(rankFeed('newlyGraduated', [ordinary, graduated]).map((item) => item.address)).toEqual([
      TOKEN_A,
    ]);
  });

  it('excludes reorged activity from all feeds', () => {
    const reorged = materializeDiscoveryItem(candidate({ canonical: false }));
    expect(rankFeed('trending', [reorged])).toEqual([]);
  });

  it('shows missing price and holder data as unavailable', () => {
    const item = materializeDiscoveryItem(
      candidate({
        priceRaw: null,
        priceDecimals: null,
        priceStatus: 'unavailable',
        holderCount: null,
      }),
    );
    expect(item.priceRaw).toBeNull();
    expect(item.holderCount).toBeNull();
    expect(item.warnings).toEqual(
      expect.arrayContaining(['PRICE_UNAVAILABLE', 'HOLDER_DATA_UNAVAILABLE']),
    );
  });

  it('paginates deterministically and rejects a cross-query cursor', () => {
    const items = [1, 2, 3, 4];
    const first = paginate(items, 2, undefined, 'trending:46630');
    const second = paginate(items, 2, first.nextCursor ?? undefined, 'trending:46630');
    expect(first.data).toEqual([1, 2]);
    expect(second.data).toEqual([3, 4]);
    expect(() => paginate(items, 2, first.nextCursor ?? undefined, 'newTokens:46630')).toThrow(
      'Cursor does not match',
    );
  });
});
