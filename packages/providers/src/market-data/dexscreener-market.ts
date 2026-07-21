import type { AggregatorPool, AggregatorToken, MarketDataSource } from './types.js';

/** DexScreener names this chain `robinhood` in its `chainId` field. */
const CHAIN_SLUG_BY_ID: Readonly<Record<number, string>> = {
  4663: 'robinhood',
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function address(value: unknown): `0x${string}` | null {
  const s = str(value);
  return s !== null && ADDRESS.test(s) ? (s.toLowerCase() as `0x${string}`) : null;
}

function numberString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
  const s = str(value);
  return s !== null && /^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(s) ? s : null;
}

export interface DexScreenerMarketOptions {
  fetchRequest?: typeof fetch;
  baseUrl?: string;
}

/** Collapse a DexScreener `pairs` array to one AggregatorToken per base token,
 *  keeping the deepest pool. Shared by search and the boosted-token feeds. */
function pairsToTokens(pairs: readonly unknown[], slug: string): AggregatorToken[] {
  const byToken = new Map<string, AggregatorToken>();
  for (const entry of pairs) {
    const pair = asRecord(entry);
    if (pair === null || str(pair.chainId) !== slug) continue;
    const base = asRecord(pair.baseToken);
    const tokenAddress = address(base?.address);
    if (tokenAddress === null) continue;
    const liquidityUsd = numberString(asRecord(pair.liquidity)?.usd);
    const candidate: AggregatorToken = {
      address: tokenAddress,
      name: str(base?.name),
      symbol: str(base?.symbol),
      decimals: null,
      priceUsd: numberString(pair.priceUsd),
      liquidityUsd,
      volume24hUsd: numberString(asRecord(pair.volume)?.h24),
      primaryPoolAddress: address(pair.pairAddress),
      poolCreatedAt:
        typeof pair.pairCreatedAt === 'number' ? new Date(pair.pairCreatedAt).toISOString() : null,
    };
    const existing = byToken.get(tokenAddress);
    if (existing === undefined || Number(liquidityUsd ?? 0) > Number(existing.liquidityUsd ?? 0)) {
      byToken.set(tokenAddress, candidate);
    }
  }
  return [...byToken.values()];
}

/**
 * A fallback market-data source. DexScreener has no true per-chain trending or
 * new-pool feed, but it does expose the chain's boosted (actively promoted)
 * tokens, which stand in for those feeds when GeckoTerminal is rate-limited —
 * without a fallback the discovery page goes blank the moment the primary is
 * throttled. Per-token queries cover any token GeckoTerminal has a gap on.
 */
export class DexScreenerMarketClient implements MarketDataSource {
  private readonly fetchRequest: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiRoot: string;

  constructor(options: DexScreenerMarketOptions = {}) {
    this.fetchRequest = options.fetchRequest ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.dexscreener.com/latest/dex';
    // The boosts endpoint lives at the API root, not under /latest/dex.
    this.apiRoot = new URL(this.baseUrl).origin;
  }

  async trending(chainId: number): Promise<AggregatorToken[]> {
    return this.boostedTokens(chainId);
  }

  async newPools(chainId: number): Promise<AggregatorToken[]> {
    // No dedicated new-pool feed; approximate "new" by newest pool creation among
    // the chain's active tokens, so the feed is populated rather than blank.
    const tokens = await this.boostedTokens(chainId);
    return [...tokens].sort(
      (a, b) => Date.parse(b.poolCreatedAt ?? '') - Date.parse(a.poolCreatedAt ?? '') || 0,
    );
  }

  /** The chain's boosted tokens, enriched with market data via a batch lookup. */
  private async boostedTokens(chainId: number): Promise<AggregatorToken[]> {
    const slug = CHAIN_SLUG_BY_ID[chainId];
    if (slug === undefined) return [];
    try {
      const boosts = await this.fetchRequest(`${this.apiRoot}/token-boosts/top/v1`, {
        headers: { accept: 'application/json' },
      });
      if (!boosts.ok) return [];
      const list = (await boosts.json()) as unknown;
      const addrs = (Array.isArray(list) ? list : [])
        .map(asRecord)
        .filter((b) => str(b?.chainId) === slug)
        .map((b) => address(b?.tokenAddress))
        .filter((a): a is `0x${string}` => a !== null)
        .slice(0, 30);
      if (addrs.length === 0) return [];
      const response = await this.fetchRequest(`${this.baseUrl}/tokens/${addrs.join(',')}`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return [];
      const body = asRecord(await response.json());
      const pairs = Array.isArray(body?.pairs) ? (body?.pairs as unknown[]) : [];
      return pairsToTokens(pairs, slug);
    } catch {
      return [];
    }
  }

  async search(chainId: number, query: string): Promise<AggregatorToken[]> {
    const slug = CHAIN_SLUG_BY_ID[chainId];
    const trimmed = query.trim();
    if (slug === undefined || trimmed.length === 0) return [];
    try {
      const response = await this.fetchRequest(
        `${this.baseUrl}/search?q=${encodeURIComponent(trimmed)}`,
        { headers: { accept: 'application/json' } },
      );
      if (!response.ok) return [];
      const body = asRecord(await response.json());
      const pairs = Array.isArray(body?.pairs) ? (body?.pairs as unknown[]) : [];
      return pairsToTokens(pairs, slug);
    } catch {
      return [];
    }
  }

  async tokenMarket(chainId: number, tokenAddress: `0x${string}`): Promise<AggregatorToken | null> {
    const pairs = await this.chainPairs(chainId, tokenAddress);
    if (pairs.length === 0) return null;
    // The deepest pair is the most representative price for the token.
    const deepest = pairs.reduce((best, pair) =>
      Number(numberString(asRecord(pair.liquidity)?.usd) ?? 0) >
      Number(numberString(asRecord(best.liquidity)?.usd) ?? 0)
        ? pair
        : best,
    );
    const base = asRecord(deepest.baseToken);
    return {
      address: tokenAddress.toLowerCase() as `0x${string}`,
      name: str(base?.name),
      symbol: str(base?.symbol),
      decimals: null,
      priceUsd: numberString(deepest.priceUsd),
      liquidityUsd: numberString(asRecord(deepest.liquidity)?.usd),
      volume24hUsd: numberString(asRecord(deepest.volume)?.h24),
      primaryPoolAddress: address(deepest.pairAddress),
      poolCreatedAt:
        typeof deepest.pairCreatedAt === 'number'
          ? new Date(deepest.pairCreatedAt).toISOString()
          : null,
    };
  }

  async pools(chainId: number, tokenAddress: `0x${string}`): Promise<AggregatorPool[]> {
    const pairs = await this.chainPairs(chainId, tokenAddress);
    const pools: AggregatorPool[] = [];
    for (const pair of pairs) {
      const poolAddress = address(pair.pairAddress);
      if (poolAddress === null) continue;
      pools.push({
        address: poolAddress,
        dexId: str(pair.dexId),
        baseTokenAddress: address(asRecord(pair.baseToken)?.address),
        quoteTokenAddress: address(asRecord(pair.quoteToken)?.address),
        liquidityUsd: numberString(asRecord(pair.liquidity)?.usd),
        createdAt:
          typeof pair.pairCreatedAt === 'number'
            ? new Date(pair.pairCreatedAt).toISOString()
            : null,
      });
    }
    return pools;
  }

  private async chainPairs(
    chainId: number,
    tokenAddress: `0x${string}`,
  ): Promise<Record<string, unknown>[]> {
    const slug = CHAIN_SLUG_BY_ID[chainId];
    if (slug === undefined) return [];
    try {
      const response = await this.fetchRequest(
        `${this.baseUrl}/tokens/${tokenAddress.toLowerCase()}`,
        { headers: { accept: 'application/json' } },
      );
      if (!response.ok) return [];
      const body = asRecord(await response.json());
      const pairs = Array.isArray(body?.pairs) ? (body?.pairs as unknown[]) : [];
      return pairs
        .map(asRecord)
        .filter(
          (pair): pair is Record<string, unknown> => pair !== null && str(pair.chainId) === slug,
        );
    } catch {
      return [];
    }
  }
}
