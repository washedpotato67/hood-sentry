import type { MarketDataSource } from '@hood-sentry/providers';
import type { RedisCache } from '@hood-sentry/queue';
import { toChecksumAddress } from '@hood-sentry/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const querySchema = z.object({
  chainId: z.coerce
    .number()
    .int()
    .refine((v) => v === 4663 || v === 46630, 'unsupported chainId'),
  q: z.string().trim().min(1).max(64),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/**
 * Full-chain token search for the command palette. Reads the aggregator's search
 * directly rather than the feed, so a name or symbol finds any token on the
 * chain, not only the handful currently trending. Cached per query for a short
 * while so keystrokes on the same term make one upstream call.
 */
export async function tokenSearchRoutes(
  app: FastifyInstance,
  options: { market: MarketDataSource; cache: RedisCache },
) {
  app.get('/search/tokens', async (request) => {
    const { chainId, q, limit } = querySchema.parse(request.query);
    const key = `search:tokens:${chainId}:${q.toLowerCase()}`;
    const results = await options.cache.getOrCompute(key, 20, async () => {
      const tokens = await options.market.search(chainId, q);
      return tokens.slice(0, limit).map((token) => ({
        address: toChecksumAddress(token.address),
        symbol: token.symbol,
        name: token.name,
        priceUsd: token.priceUsd,
        liquidityUsd: token.liquidityUsd,
        volume24hUsd: token.volume24hUsd,
      }));
    });
    return { data: results };
  });
}
