import type { Token } from '@hood-sentry/db';
import type { BlockscoutHoldersClient, MarketDataSource } from '@hood-sentry/providers';
import type { RedisCache } from '@hood-sentry/queue';

/**
 * Assembles the token record the token page needs from live sources instead of
 * an indexed table: market metadata and price from the aggregator, supply and
 * decimals from the block explorer. Cached briefly so a page's parallel reads
 * and repeat views make one upstream call.
 *
 * Returns null only when neither source knows the token, which the route treats
 * as not found. A token with market data but, say, no explorer supply still
 * renders, with the missing field null.
 */
export async function aggregatorToken(
  chainId: number,
  address: `0x${string}`,
  market: MarketDataSource,
  holders: BlockscoutHoldersClient,
  cache: RedisCache,
  now: () => Date = () => new Date(),
): Promise<Token | null> {
  const cached = await cache.getOrCompute<Token | null>(
    `token:record:${chainId}:${address.toLowerCase()}`,
    60,
    async () => {
      const [marketData, explorer] = await Promise.all([
        market.tokenMarket(chainId, address),
        holders.tokenHolders(address),
      ]);
      const hasMarket = marketData !== null;
      const hasSupply = explorer.totalSupplyRaw !== null;
      if (!hasMarket && !hasSupply) return null;

      const timestamp = now();
      return {
        chainId,
        address: address.toLowerCase(),
        name: marketData?.name ?? null,
        symbol: marketData?.symbol ?? null,
        decimals: marketData?.decimals ?? explorer.decimals ?? null,
        totalSupplyRaw: explorer.totalSupplyRaw,
        tokenType: 'erc20',
        canonicalAssetKey: null,
        logoUri: null,
        metadataStatus: hasMarket ? 'complete' : 'partial',
        spamStatus: 'unknown',
        firstSeenBlock: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },
  );
  // Dates survive the JSON round trip as strings; restore them.
  if (cached === null) return null;
  return {
    ...cached,
    createdAt: new Date(cached.createdAt),
    updatedAt: new Date(cached.updatedAt),
  };
}
