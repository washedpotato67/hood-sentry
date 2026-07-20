import type { DiscoveryItem } from '@hood-sentry/discovery-engine';
import type { AggregatorToken, MarketDataSource } from '@hood-sentry/providers';
import { decimalToRaw } from '@hood-sentry/providers';
import type { RedisCache } from '@hood-sentry/queue';
import { getAddress } from 'viem';
import type { DiscoveryReadRepository } from './routes/discovery.js';

const METHODOLOGY = 'aggregator-v1';
// USD amounts are carried in the raw-integer model at 18 decimals so the existing
// formatters render them unchanged.
const USD_DECIMALS = 18;

function usdToRaw(value: string | null): bigint | null {
  if (value === null) return null;
  try {
    return BigInt(decimalToRaw(value, USD_DECIMALS));
  } catch {
    return null;
  }
}

/**
 * Map an aggregator token to the discovery item shape the feed route ranks and
 * serves. Fields the aggregator does not provide are left at honest defaults:
 * no risk grade (computed elsewhere, on demand), no launchpad or project state,
 * no first-seen block (we did not index its creation). `rankOrder` preserves the
 * aggregator's own ordering by feeding the trending comparator a descending
 * score, and doubles as the volume/liquidity ranking proxy since a single
 * snapshot carries no change-over-time.
 */
export function aggregatorTokenToDiscoveryItem(
  chainId: number,
  token: AggregatorToken,
  rankOrder: number,
  observedAt: string,
): DiscoveryItem {
  const priceRaw = usdToRaw(token.priceUsd);
  const liquidityRaw = usdToRaw(token.liquidityUsd);
  const volumeRaw = usdToRaw(token.volume24hUsd);
  const score = BigInt(Math.max(0, rankOrder));

  return {
    chainId,
    address: getAddress(token.address),
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    tokenType: 'erc20',
    canonicalState: 'unknown',
    canonicalTicker: null,
    projectName: null,
    projectSlug: null,
    projectVerified: false,
    projectVerifiedAt: null,
    deployerAddress: null,
    primaryPoolAddress:
      token.primaryPoolAddress === null ? null : getAddress(token.primaryPoolAddress),
    poolAddresses: token.primaryPoolAddress === null ? [] : [getAddress(token.primaryPoolAddress)],
    protocolKey: null,
    launchpadKey: null,
    quoteAssetAddress: null,
    firstSeenBlockNumber: 0n,
    firstSeenAt: token.poolCreatedAt,
    poolCreatedBlockNumber: null,
    poolCreatedAt: token.poolCreatedAt,
    priceRaw,
    priceDecimals: priceRaw === null ? null : USD_DECIMALS,
    priceStatus: priceRaw === null ? 'unavailable' : 'available',
    priceObservedAt: priceRaw === null ? null : observedAt,
    liquidityRaw,
    liquidityDecimals: liquidityRaw === null ? null : USD_DECIMALS,
    volumeRaw,
    volumeDecimals: volumeRaw === null ? null : USD_DECIMALS,
    volumeChangeBps: volumeRaw,
    liquidityChangeBps: liquidityRaw,
    holderCount: null,
    holderGrowth: null,
    holderConcentrationBps: null,
    transactionCount: null,
    transactionGrowthBps: null,
    uniqueTraders: null,
    watchlistCount: 0n,
    watchlistGrowth: null,
    alertCount: 0n,
    alertCreationGrowth: null,
    launchpadState: 'none',
    launchpadCurveProgressBps: null,
    graduatedAt: null,
    migratedAt: null,
    riskGrade: 'unavailable',
    riskCompletenessBps: null,
    suspiciousDeployerEvidence: [],
    duplicateSymbolAddresses: [],
    dataQualityWarnings: [],
    lastScannedAt: null,
    latestCriticalFindingAt: null,
    sourceBlockNumber: 0n,
    sourceBlockHash: `0x${'0'.repeat(64)}`,
    sourceTimestamp: observedAt,
    observedAt,
    canonical: true,
    relatedWalletAddresses: [],
    trending: {
      methodologyVersion: METHODOLOGY,
      scoreBps: score,
      confidenceBps: 0n,
      components: [],
      manipulation: {
        methodologyVersion: METHODOLOGY,
        confidenceBps: 0n,
        totalPenaltyBps: 0n,
        signals: [],
      },
    },
    dataFreshnessSeconds: 0n,
    warnings: [],
  };
}

/**
 * Serves the discovery feed from a market-data aggregator instead of an indexed
 * database. The route ranks and paginates whatever this returns, so it fetches
 * the aggregator's trending and new-pool feeds, unions them by token, and hands
 * back one snapshot for the route to slice per feed. Cached briefly so a burst
 * of feed requests makes one upstream call.
 */
export class AggregatorDiscoveryRepository implements DiscoveryReadRepository {
  constructor(
    private readonly market: MarketDataSource,
    private readonly cache: RedisCache,
    private readonly options: {
      ttlSeconds?: number;
      now?: () => string;
      holders?: { holderCount(address: `0x${string}`): Promise<bigint | null> };
    } = {},
  ) {}

  async listCurrent(chainId: number): Promise<readonly DiscoveryItem[]> {
    const ttl = this.options.ttlSeconds ?? 60;
    const now = this.options.now ?? (() => new Date().toISOString());

    // The cache holds the aggregator's plain tokens; the bigint-carrying
    // discovery items are built fresh on each read. Keeping bigints out of the
    // cache avoids encoding them into JSON and decoding them back.
    const tokens = await this.cache.getOrCompute<AggregatorToken[]>(
      `discovery:tokens:${chainId}`,
      ttl,
      async () => {
        const [trending, newPools] = await Promise.all([
          this.market.trending(chainId),
          this.market.newPools(chainId),
        ]);
        const byAddress = new Map<string, AggregatorToken>();
        for (const token of [...trending, ...newPools]) {
          if (!byAddress.has(token.address)) byAddress.set(token.address, token);
        }
        return [...byAddress.values()];
      },
    );

    const holderCounts = await this.holderCounts(chainId, tokens);
    const observedAt = now();
    return tokens.map((token, index) => {
      const item = aggregatorTokenToDiscoveryItem(
        chainId,
        token,
        tokens.length - index,
        observedAt,
      );
      const count = holderCounts.get(token.address.toLowerCase());
      return count === undefined ? item : { ...item, holderCount: count };
    });
  }

  /**
   * Holder count per token from the explorer, each cached well beyond the feed's
   * own TTL: counts change slowly, so caching per token keeps a feed refresh from
   * asking the explorer about every token every minute. A token whose count
   * cannot be read is simply left out and renders as unavailable.
   */
  private async holderCounts(
    chainId: number,
    tokens: readonly AggregatorToken[],
  ): Promise<Map<string, bigint>> {
    const counts = new Map<string, bigint>();
    if (this.options.holders === undefined) return counts;
    const holders = this.options.holders;
    await Promise.all(
      tokens.map(async (token) => {
        const cached = await this.cache.getOrCompute<string | null>(
          `holders:count:${chainId}:${token.address.toLowerCase()}`,
          600,
          async () => {
            const count = await holders.holderCount(token.address);
            return count === null ? null : count.toString();
          },
        );
        if (cached !== null) counts.set(token.address.toLowerCase(), BigInt(cached));
      }),
    );
    return counts;
  }

  async listSponsoredPlacements(): Promise<[]> {
    // Sponsored placements were a database feature; the lean product has none.
    return [];
  }
}
