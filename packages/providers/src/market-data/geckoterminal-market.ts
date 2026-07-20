import type { AggregatorPool, AggregatorToken, MarketDataSource } from './types.js';

/**
 * GeckoTerminal names networks rather than numbering them and covers only the
 * ones it has indexed. An unmapped chain yields nothing rather than another
 * chain's data.
 */
const NETWORK_BY_CHAIN_ID: Readonly<Record<number, string>> = {
  4663: 'robinhood',
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parses `robinhood_0xabc…` (or a bare address) into a checksum-free address. */
function tokenAddressFromId(id: unknown): `0x${string}` | null {
  const raw = str(id);
  if (raw === null) return null;
  const candidate = raw.includes('_') ? (raw.split('_').pop() ?? '') : raw;
  return ADDRESS.test(candidate) ? (candidate.toLowerCase() as `0x${string}`) : null;
}

function numberString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toString();
  const s = str(value);
  return s !== null && /^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(s) ? s : null;
}

export interface GeckoTerminalMarketOptions {
  fetchRequest?: typeof fetch;
  baseUrl?: string;
}

/**
 * Reads trending pools, new pools, and per-token market data from
 * GeckoTerminal's public API, which covers this chain and needs no key. The
 * trending and new-pool feeds are per-pool; they are collapsed to one entry per
 * base token, keeping the deepest pool, so the discovery feed is token-level.
 */
export class GeckoTerminalMarketClient implements MarketDataSource {
  private readonly fetchRequest: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: GeckoTerminalMarketOptions = {}) {
    this.fetchRequest = options.fetchRequest ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.geckoterminal.com/api/v2';
  }

  async trending(chainId: number): Promise<AggregatorToken[]> {
    return this.poolFeed(chainId, 'trending_pools');
  }

  async newPools(chainId: number): Promise<AggregatorToken[]> {
    return this.poolFeed(chainId, 'new_pools');
  }

  async tokenMarket(chainId: number, address: `0x${string}`): Promise<AggregatorToken | null> {
    const network = NETWORK_BY_CHAIN_ID[chainId];
    if (network === undefined) return null;
    const body = await this.getJson(
      `${this.baseUrl}/networks/${network}/tokens/${address.toLowerCase()}?include=top_pools`,
    );
    if (body === null) return null;
    const data = asRecord(asRecord(body)?.data);
    const attrs = asRecord(data?.attributes);
    if (attrs === null) return null;
    const included = Array.isArray(asRecord(body)?.included)
      ? (asRecord(body)?.included as unknown[])
      : [];
    const topPool = included.map(asRecord).find((entry) => entry?.type === 'pool');
    const poolAttrs = asRecord(topPool?.attributes);
    return {
      address: address.toLowerCase() as `0x${string}`,
      name: str(attrs.name),
      symbol: str(attrs.symbol),
      decimals: typeof attrs.decimals === 'number' ? attrs.decimals : null,
      priceUsd: numberString(attrs.price_usd),
      liquidityUsd: numberString(poolAttrs?.reserve_in_usd),
      volume24hUsd: numberString(asRecord(poolAttrs?.volume_usd)?.h24),
      primaryPoolAddress:
        tokenAddressFromId(poolAttrs?.address) ?? tokenAddressFromId(str(topPool?.id)),
      poolCreatedAt: str(poolAttrs?.pool_created_at),
    };
  }

  async pools(chainId: number, address: `0x${string}`): Promise<AggregatorPool[]> {
    const network = NETWORK_BY_CHAIN_ID[chainId];
    if (network === undefined) return [];
    const body = await this.getJson(
      `${this.baseUrl}/networks/${network}/tokens/${address.toLowerCase()}/pools`,
    );
    const data = Array.isArray(asRecord(body)?.data) ? (asRecord(body)?.data as unknown[]) : [];
    const pools: AggregatorPool[] = [];
    for (const entry of data) {
      const pool = asRecord(entry);
      const attrs = asRecord(pool?.attributes);
      const poolAddress = tokenAddressFromId(attrs?.address) ?? tokenAddressFromId(str(pool?.id));
      if (poolAddress === null) continue;
      const rel = asRecord(pool?.relationships);
      pools.push({
        address: poolAddress,
        dexId: str(asRecord(asRecord(rel?.dex)?.data)?.id),
        baseTokenAddress: tokenAddressFromId(asRecord(asRecord(rel?.base_token)?.data)?.id),
        quoteTokenAddress: tokenAddressFromId(asRecord(asRecord(rel?.quote_token)?.data)?.id),
        liquidityUsd: numberString(attrs?.reserve_in_usd),
        createdAt: str(attrs?.pool_created_at),
      });
    }
    return pools;
  }

  async search(chainId: number, query: string): Promise<AggregatorToken[]> {
    const network = NETWORK_BY_CHAIN_ID[chainId];
    const trimmed = query.trim();
    if (network === undefined || trimmed.length === 0) return [];
    const body = await this.getJson(
      `${this.baseUrl}/search/pools?query=${encodeURIComponent(trimmed)}&network=${network}&include=base_token&page=1`,
    );
    return this.tokensFromPools(body);
  }

  private async poolFeed(chainId: number, feed: string): Promise<AggregatorToken[]> {
    const network = NETWORK_BY_CHAIN_ID[chainId];
    if (network === undefined) return [];
    const body = await this.getJson(
      `${this.baseUrl}/networks/${network}/${feed}?include=base_token&page=1`,
    );
    return this.tokensFromPools(body);
  }

  /** Collapse a pool list (with included base-token metadata) to one entry per token. */
  private tokensFromPools(body: unknown | null): AggregatorToken[] {
    if (body === null) return [];
    const data = Array.isArray(asRecord(body)?.data) ? (asRecord(body)?.data as unknown[]) : [];
    const included = Array.isArray(asRecord(body)?.included)
      ? (asRecord(body)?.included as unknown[])
      : [];
    const tokensById = new Map<string, Record<string, unknown>>();
    for (const entry of included) {
      const record = asRecord(entry);
      const id = str(record?.id);
      if (record?.type === 'token' && id !== null) tokensById.set(id, record);
    }

    // One entry per base token, keeping the deepest pool.
    const byToken = new Map<string, AggregatorToken>();
    for (const entry of data) {
      const pool = asRecord(entry);
      const attrs = asRecord(pool?.attributes);
      const baseId = str(asRecord(asRecord(asRecord(pool?.relationships)?.base_token)?.data)?.id);
      const tokenAddress = tokenAddressFromId(baseId);
      if (attrs === null || tokenAddress === null) continue;
      const meta = asRecord(baseId !== null ? tokensById.get(baseId)?.attributes : undefined);
      const liquidity = numberString(attrs.reserve_in_usd);
      const candidate: AggregatorToken = {
        address: tokenAddress,
        name: str(meta?.name),
        symbol: str(meta?.symbol),
        decimals: typeof meta?.decimals === 'number' ? meta.decimals : null,
        priceUsd: numberString(attrs.base_token_price_usd),
        liquidityUsd: liquidity,
        volume24hUsd: numberString(asRecord(attrs.volume_usd)?.h24),
        primaryPoolAddress: tokenAddressFromId(attrs.address) ?? tokenAddressFromId(str(pool?.id)),
        poolCreatedAt: str(attrs.pool_created_at),
      };
      const existing = byToken.get(tokenAddress);
      if (
        existing === undefined ||
        Number(candidate.liquidityUsd ?? 0) > Number(existing.liquidityUsd ?? 0)
      ) {
        byToken.set(tokenAddress, candidate);
      }
    }
    return [...byToken.values()];
  }

  private async getJson(url: string): Promise<unknown | null> {
    try {
      const response = await this.fetchRequest(url, { headers: { accept: 'application/json' } });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }
}
