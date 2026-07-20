import type { AggregatorToken, MarketDataSource } from '@hood-sentry/providers';
import { RedisCache } from '@hood-sentry/queue';
import { describe, expect, it } from 'vitest';
import {
  AggregatorDiscoveryRepository,
  aggregatorTokenToDiscoveryItem,
} from '../aggregator-discovery.js';

const TOKEN = '0x020bfc650a365f8bb26819deaabf3e21291018b4' as const;

function token(overrides: Partial<AggregatorToken> = {}): AggregatorToken {
  return {
    address: TOKEN,
    name: 'Cash Cat',
    symbol: 'CASHCAT',
    decimals: 18,
    priceUsd: '0.0783705',
    liquidityUsd: '3760730.03',
    volume24hUsd: '5629048.80',
    primaryPoolAddress: '0xa70fc67c9f69da90b63a0e4c05d229954574e313',
    poolCreatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function fakeCache(): RedisCache {
  const store = new Map<string, string>();
  return new RedisCache({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
      return 'OK';
    },
    del: async (k) => {
      store.delete(k);
      return 1;
    },
  });
}

describe('aggregatorTokenToDiscoveryItem', () => {
  it('carries price, liquidity and volume as raw integers at 18 decimals', () => {
    const item = aggregatorTokenToDiscoveryItem(4663, token(), 20, '2026-07-20T00:00:00Z');

    expect(item.symbol).toBe('CASHCAT');
    expect(item.priceStatus).toBe('available');
    expect(item.priceDecimals).toBe(18);
    // 0.0783705 * 10^18
    expect(item.priceRaw).toBe(78370500000000000n);
    expect(item.liquidityRaw).toBe(3760730030000000000000000n);
    expect(item.trending.scoreBps).toBe(20n);
  });

  it('reports no risk grade — risk is computed on demand, not from the feed', () => {
    const item = aggregatorTokenToDiscoveryItem(4663, token(), 1, '2026-07-20T00:00:00Z');
    expect(item.riskGrade).toBe('unavailable');
  });

  it('marks price unavailable when the aggregator has none', () => {
    const item = aggregatorTokenToDiscoveryItem(
      4663,
      token({ priceUsd: null }),
      1,
      '2026-07-20T00:00:00Z',
    );
    expect(item.priceStatus).toBe('unavailable');
    expect(item.priceRaw).toBeNull();
  });
});

describe('AggregatorDiscoveryRepository', () => {
  const market: MarketDataSource = {
    trending: async () => [token()],
    newPools: async () => [token({ address: '0x1111111111111111111111111111111111111111' })],
    tokenMarket: async () => null,
    pools: async () => [],
    search: async () => [],
  };

  it('unions trending and new pools, one entry per token, ranked by input order', async () => {
    const repo = new AggregatorDiscoveryRepository(market, fakeCache(), {
      now: () => '2026-07-20T00:00:00Z',
    });

    const items = await repo.listCurrent(4663);

    expect(items).toHaveLength(2);
    expect(items[0]?.symbol).toBe('CASHCAT');
    // The first token gets the highest trending score so it ranks first.
    expect((items[0]?.trending.scoreBps ?? 0n) > (items[1]?.trending.scoreBps ?? 0n)).toBe(true);
  });

  it('has no sponsored placements', async () => {
    const repo = new AggregatorDiscoveryRepository(market, fakeCache());
    expect(await repo.listSponsoredPlacements()).toEqual([]);
  });
});
