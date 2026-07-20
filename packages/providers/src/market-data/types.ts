/**
 * A token as a market-data aggregator reports it. Amounts are decimal strings in
 * US dollars, the unit aggregators quote in; the raw-integer form the product
 * stores is derived at the mapping layer, not here. A field is null when the
 * aggregator does not report it, never a guessed value.
 */
export interface AggregatorToken {
  address: `0x${string}`;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  priceUsd: string | null;
  liquidityUsd: string | null;
  volume24hUsd: string | null;
  /** The pool this token's market reads from, if the aggregator names one. */
  primaryPoolAddress: `0x${string}` | null;
  poolCreatedAt: string | null;
}

/** A liquidity pool as an aggregator reports it. */
export interface AggregatorPool {
  address: `0x${string}`;
  dexId: string | null;
  baseTokenAddress: `0x${string}` | null;
  quoteTokenAddress: `0x${string}` | null;
  liquidityUsd: string | null;
  createdAt: string | null;
}

/**
 * A source of market data for a chain the product does not index itself. Every
 * method is a pure read: a failing source returns an empty list or null so the
 * caller can fall back to another source or degrade the page, never throw a
 * request into a 500.
 */
export interface MarketDataSource {
  trending(chainId: number): Promise<AggregatorToken[]>;
  newPools(chainId: number): Promise<AggregatorToken[]>;
  tokenMarket(chainId: number, address: `0x${string}`): Promise<AggregatorToken | null>;
  pools(chainId: number, address: `0x${string}`): Promise<AggregatorPool[]>;
  /** Free-text token search by name, symbol, or address across the chain. */
  search(chainId: number, query: string): Promise<AggregatorToken[]>;
}
