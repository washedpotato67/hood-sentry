import type {
  AiTokenReportProvider,
  BlockscoutHoldersClient,
  MarketDataSource,
  TokenReportFacts,
} from '@hood-sentry/providers';
import { AiTokenReportProviderError } from '@hood-sentry/providers';
import type { RedisCache } from '@hood-sentry/queue';
import { toChecksumAddress } from '@hood-sentry/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const paramsSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'invalid address'),
});
const querySchema = z.object({
  chainId: z.coerce
    .number()
    .int()
    .refine((v) => v === 4663 || v === 46630, 'unsupported chainId'),
});

export type AiReportRouteOptions = {
  /** Null when AI explanations are disabled or no key is configured. */
  provider: AiTokenReportProvider | null;
  market: MarketDataSource;
  holders: BlockscoutHoldersClient;
  cache: RedisCache;
  cacheSeconds: number;
};

/**
 * An AI narration of a token's live facts. The deterministic values come from
 * the aggregator and the block explorer; the model only turns them into a
 * plain-language read. The finished report is cached so repeat views and
 * parallel readers make one paid call, not one per request.
 *
 * The route degrades rather than errors: a disabled provider returns 503 with a
 * code the page renders as "unavailable", and a provider failure surfaces the
 * same way instead of a 500.
 */
export async function aiReportRoutes(app: FastifyInstance, options: AiReportRouteOptions) {
  app.get('/tokens/:address/ai-report', async (request, reply) => {
    const { address } = paramsSchema.parse(request.params);
    const { chainId } = querySchema.parse(request.query);
    const checksummed = toChecksumAddress(address);
    const lower = checksummed.toLowerCase() as `0x${string}`;

    if (options.provider === null) {
      reply.code(503);
      return {
        error: {
          code: 'AI_REPORT_DISABLED',
          message: 'AI reports are not enabled on this deployment.',
        },
      };
    }
    const provider = options.provider;

    try {
      const report = await options.cache.getOrCompute(
        // Version suffix (v3): bump to invalidate reports cached under an older
        // prompt, e.g. ones that mislabelled the chain or used em dashes.
        `ai:report:v3:${chainId}:${lower}`,
        options.cacheSeconds,
        async () => {
          const [market, pools, holderCount] = await Promise.all([
            options.market.tokenMarket(chainId, lower),
            options.market.pools(chainId, lower),
            options.holders.holderCount(lower),
          ]);
          // Nothing to narrate if no source recognises the token at all.
          if (market === null && pools.length === 0 && holderCount === null) {
            return null;
          }
          const facts: TokenReportFacts = {
            chainId,
            // Tokens on this product are always on Robinhood Chain; give the
            // model the name so it never infers a network from the numeric id.
            chain: chainId === 46630 ? 'Robinhood Chain Testnet' : 'Robinhood Chain',
            address: checksummed,
            name: market?.name ?? null,
            symbol: market?.symbol ?? null,
            priceUsd: market?.priceUsd ?? null,
            liquidityUsd: market?.liquidityUsd ?? null,
            volume24hUsd: market?.volume24hUsd ?? null,
            holderCount: holderCount === null ? null : holderCount.toString(),
            poolCount: pools.length,
          };
          const result = await provider.generate(facts);
          return {
            address: checksummed,
            chainId,
            model: result.model,
            promptVersion: result.promptVersion,
            facts,
            report: result.report,
            generatedAt: new Date().toISOString(),
          };
        },
      );

      if (report === null) {
        reply.code(404);
        return { error: { code: 'TOKEN_NOT_FOUND', message: 'No live data for this token.' } };
      }
      return { data: report };
    } catch (error) {
      if (error instanceof AiTokenReportProviderError) {
        request.log.warn({ code: error.code }, 'ai report generation failed');
        reply.code(503);
        return {
          error: {
            code: 'AI_REPORT_UNAVAILABLE',
            message: 'The AI report could not be generated.',
          },
        };
      }
      throw error;
    }
  });
}
