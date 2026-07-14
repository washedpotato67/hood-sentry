import { createHash } from 'node:crypto';
import {
  discoveryFeedSchema,
  discoveryQuerySchema,
  discoverySearchQuerySchema,
} from '@hood-sentry/api-contracts';
import type { DiscoveryRepository } from '@hood-sentry/db';
import {
  type DiscoveryFilters,
  TRENDING_METHODOLOGY_VERSION,
  matchesDiscoveryFilters,
  paginate,
  rankFeed,
  rankSponsored,
  searchDiscovery,
} from '@hood-sentry/discovery-engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const feedParamsSchema = z.object({ feed: discoveryFeedSchema });

export type DiscoveryReadRepository = Pick<
  DiscoveryRepository,
  'listCurrent' | 'listSponsoredPlacements'
>;

function filtersFromQuery(query: z.infer<typeof discoveryQuerySchema>): DiscoveryFilters {
  return {
    maximumTokenAgeSeconds:
      query.maximumTokenAgeSeconds === undefined ? undefined : BigInt(query.maximumTokenAgeSeconds),
    maximumPoolAgeSeconds:
      query.maximumPoolAgeSeconds === undefined ? undefined : BigInt(query.maximumPoolAgeSeconds),
    minimumLiquidityRaw:
      query.minimumLiquidityRaw === undefined ? undefined : BigInt(query.minimumLiquidityRaw),
    minimumVolumeRaw:
      query.minimumVolumeRaw === undefined ? undefined : BigInt(query.minimumVolumeRaw),
    minimumHolders: query.minimumHolders === undefined ? undefined : BigInt(query.minimumHolders),
    riskGrades: query.riskGrades,
    minimumRiskCompletenessBps:
      query.minimumRiskCompletenessBps === undefined
        ? undefined
        : BigInt(query.minimumRiskCompletenessBps),
    projectVerified: query.projectVerified,
    canonicalState: query.canonicalState,
    protocolKey: query.protocolKey,
    launchpadKey: query.launchpadKey,
    quoteAssetAddress: query.quoteAssetAddress,
    migrationStatus: query.migrationStatus,
    graduationStatus: query.graduationStatus,
    stockTokenCategory: query.stockTokenCategory,
    etfCategory: query.etfCategory,
    maximumDataAgeSeconds:
      query.maximumDataAgeSeconds === undefined ? undefined : BigInt(query.maximumDataAgeSeconds),
  };
}

function serialize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  );
}

function snapshotFingerprint(values: readonly string[]): string {
  const hash = createHash('sha256');
  for (const value of values) hash.update(`${value}\n`);
  return hash.digest('hex');
}

export async function discoveryRoutes(
  app: FastifyInstance,
  options: { repository: DiscoveryReadRepository; now?: () => string },
) {
  const now = options.now ?? (() => new Date().toISOString());

  app.get('/discovery/:feed', async (request) => {
    const { feed } = feedParamsSchema.parse(request.params);
    const query = discoveryQuerySchema.parse(request.query);
    const observedAt = now();
    const [items, placements] = await Promise.all([
      options.repository.listCurrent(query.chainId, TRENDING_METHODOLOGY_VERSION),
      options.repository.listSponsoredPlacements(query.chainId),
    ]);
    const filters = filtersFromQuery(query);
    const filtered = items.filter((item) => matchesDiscoveryFilters(item, filters, observedAt));
    const organic = rankFeed(feed, filtered);
    const sponsored = rankSponsored(feed, placements, filtered, observedAt);
    const queryFingerprint = `${feed}:${query.chainId}:${JSON.stringify({ ...query, cursor: undefined, sponsoredCursor: undefined })}`;
    const organicFingerprint = snapshotFingerprint(
      organic.map((item) => `${item.address.toLowerCase()}:${item.sourceBlockNumber.toString()}`),
    );
    const sponsoredFingerprint = snapshotFingerprint(
      sponsored.map(
        (entry) =>
          `${entry.placement.placementId}:${entry.placement.priority}:${entry.item.address.toLowerCase()}:${entry.item.sourceBlockNumber.toString()}`,
      ),
    );
    return {
      data: serialize({
        organic: paginate(
          organic,
          query.limit,
          query.cursor,
          `organic:${queryFingerprint}:${organicFingerprint}`,
        ),
        sponsored: paginate(
          sponsored,
          query.limit,
          query.sponsoredCursor,
          `sponsored:${queryFingerprint}:${sponsoredFingerprint}`,
        ),
      }),
    };
  });

  app.get('/search', async (request) => {
    const query = discoverySearchQuerySchema.parse(request.query);
    const items = await options.repository.listCurrent(query.chainId, TRENDING_METHODOLOGY_VERSION);
    const results = searchDiscovery(items, query.query);
    const resultFingerprint = snapshotFingerprint(
      results.map(
        (result) =>
          `${result.rank}:${result.item.address.toLowerCase()}:${result.item.sourceBlockNumber.toString()}`,
      ),
    );
    const page = paginate(
      results,
      query.limit,
      query.cursor,
      `search:${query.chainId}:${query.query.toLowerCase()}:${resultFingerprint}`,
    );
    return { data: serialize(page) };
  });
}
