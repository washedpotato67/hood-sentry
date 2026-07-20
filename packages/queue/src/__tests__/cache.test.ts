import { describe, expect, it, vi } from 'vitest';
import { type CacheClient, RedisCache } from '../cache.js';

/** An in-memory stand-in for Redis with EX and NX honoured. */
function fakeRedis(): CacheClient & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, _mode: 'EX', _ttl: number, nx?: 'NX') {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async del(key) {
      store.delete(key);
      return 1;
    },
  } as CacheClient & { store: Map<string, string> };
}

function throwingRedis(): CacheClient {
  const fail = async () => {
    throw new Error('redis down');
  };
  return { get: fail, set: fail, del: fail } as unknown as CacheClient;
}

describe('RedisCache', () => {
  it('computes on a miss and returns the cached value on the next read', async () => {
    const cache = new RedisCache(fakeRedis());
    const compute = vi.fn(async () => ({ price: '42' }));

    const first = await cache.getOrCompute('token:x', 60, compute);
    const second = await cache.getOrCompute('token:x', 60, compute);

    expect(first).toEqual({ price: '42' });
    expect(second).toEqual({ price: '42' });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('computes once when two callers miss the same key at the same time', async () => {
    const cache = new RedisCache(fakeRedis(), { lockPollMs: 5 });
    let running = 0;
    let concurrent = 0;
    const compute = vi.fn(async () => {
      running += 1;
      concurrent = Math.max(concurrent, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return { v: 1 };
    });

    const [a, b] = await Promise.all([
      cache.getOrCompute('k', 60, compute),
      cache.getOrCompute('k', 60, compute),
    ]);

    expect(a).toEqual({ v: 1 });
    expect(b).toEqual({ v: 1 });
    expect(concurrent).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('computes every time rather than failing when Redis is unreachable', async () => {
    const cache = new RedisCache(throwingRedis(), { lockWaitMs: 20, lockPollMs: 5 });
    const compute = vi.fn(async () => 'value');

    const first = await cache.getOrCompute('k', 60, compute);
    const second = await cache.getOrCompute('k', 60, compute);

    expect(first).toBe('value');
    expect(second).toBe('value');
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('set then get round-trips a value', async () => {
    const cache = new RedisCache(fakeRedis());
    await cache.set('k', 60, { grade: 'B' });
    expect(await cache.get('k')).toEqual({ grade: 'B' });
  });

  it('returns undefined for an absent key', async () => {
    const cache = new RedisCache(fakeRedis());
    expect(await cache.get('missing')).toBeUndefined();
  });
});
