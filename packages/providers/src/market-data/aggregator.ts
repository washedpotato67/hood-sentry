import { DexScreenerMarketClient } from './dexscreener-market.js';
import { GeckoTerminalMarketClient } from './geckoterminal-market.js';
import type { AggregatorPool, AggregatorToken, MarketDataSource } from './types.js';

/**
 * Combines a primary market-data source with a fallback.
 *
 * The primary answers the feed queries. For per-token queries, the fallback is
 * consulted when the primary has no data, so a token GeckoTerminal has not
 * picked up can still be priced from DexScreener. Neither is treated as
 * authoritative over the chain: both are attributed as external data where the
 * product displays them.
 */
export class MarketDataAggregator implements MarketDataSource {
  constructor(
    private readonly primary: MarketDataSource,
    private readonly fallback: MarketDataSource,
  ) {}

  static withDefaults(fetchRequest?: typeof fetch): MarketDataAggregator {
    return new MarketDataAggregator(
      new GeckoTerminalMarketClient({ fetchRequest }),
      new DexScreenerMarketClient({ fetchRequest }),
    );
  }

  trending(chainId: number): Promise<AggregatorToken[]> {
    return this.primary.trending(chainId);
  }

  newPools(chainId: number): Promise<AggregatorToken[]> {
    return this.primary.newPools(chainId);
  }

  async tokenMarket(chainId: number, address: `0x${string}`): Promise<AggregatorToken | null> {
    const primary = await this.primary.tokenMarket(chainId, address);
    if (primary !== null && primary.priceUsd !== null) return primary;
    const fallback = await this.fallback.tokenMarket(chainId, address);
    return fallback ?? primary;
  }

  async search(chainId: number, query: string): Promise<AggregatorToken[]> {
    const primary = await this.primary.search(chainId, query);
    if (primary.length > 0) return primary;
    return this.fallback.search(chainId, query);
  }

  async pools(chainId: number, address: `0x${string}`): Promise<AggregatorPool[]> {
    const primary = await this.primary.pools(chainId, address);
    if (primary.length > 0) return primary;
    return this.fallback.pools(chainId, address);
  }
}
