import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DiscoveryReadRepository, discoveryRoutes } from '../routes/discovery.js';

class ReadRepository implements DiscoveryReadRepository {
  async listCurrent() {
    return [];
  }

  async listSponsoredPlacements() {
    return [];
  }
}

describe('discovery read routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(discoveryRoutes, {
      prefix: '/v1',
      repository: new ReadRepository(),
      now: () => '2026-07-14T12:00:00.000Z',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns separate organic and sponsored pages', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/discovery/trending?chainId=4663',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        organic: { data: [], nextCursor: null, hasMore: false },
        sponsored: { data: [], nextCursor: null, hasMore: false },
      },
    });
  });

  it('rejects an unsupported feed and an empty search term', async () => {
    const feed = await app.inject({ method: 'GET', url: '/v1/discovery/pricePump?chainId=4663' });
    const search = await app.inject({ method: 'GET', url: '/v1/search?chainId=4663&query=' });
    expect(feed.statusCode).toBe(500);
    expect(search.statusCode).toBe(500);
  });
});
