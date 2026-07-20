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

/**
 * A fallback market-data source. DexScreener has no per-chain trending feed, so
 * it only answers token-level queries; its value is covering a token when
 * GeckoTerminal has a gap. Trending and new-pool feeds return empty here so the
 * aggregator keeps whatever the primary produced.
 */
export class DexScreenerMarketClient implements MarketDataSource {
  private readonly fetchRequest: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: DexScreenerMarketOptions = {}) {
    this.fetchRequest = options.fetchRequest ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.dexscreener.com/latest/dex';
  }

  async trending(): Promise<AggregatorToken[]> {
    return [];
  }

  async newPools(): Promise<AggregatorToken[]> {
    return [];
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
            typeof pair.pairCreatedAt === 'number'
              ? new Date(pair.pairCreatedAt).toISOString()
              : null,
        };
        const existing = byToken.get(tokenAddress);
        if (
          existing === undefined ||
          Number(liquidityUsd ?? 0) > Number(existing.liquidityUsd ?? 0)
        ) {
          byToken.set(tokenAddress, candidate);
        }
      }
      return [...byToken.values()];
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
