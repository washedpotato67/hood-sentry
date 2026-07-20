/**
 * The subset of Redis this cache uses, so tests can supply a fake without a
 * server and callers can pass any compatible client.
 */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  set(
    key: string,
    value: string,
    mode: 'EX',
    ttlSeconds: number,
    nx: 'NX',
  ): Promise<unknown | null>;
  del(key: string): Promise<unknown>;
}

export interface CacheOptions {
  /**
   * How long to wait for another caller that is already computing the same key
   * before giving up and computing it independently. Keeps a slow upstream from
   * stalling every waiter indefinitely.
   */
  lockWaitMs?: number;
  lockPollMs?: number;
  lockTtlSeconds?: number;
}

/**
 * A read-through cache over Redis with single-flight semantics.
 *
 * On a miss, one caller takes a short lock and computes the value; concurrent
 * callers wait briefly for that result rather than all hitting the upstream at
 * once. Redis being unreachable degrades to computing every time rather than
 * failing the request: a cache is an optimisation, never a dependency.
 */
export class RedisCache {
  private readonly lockWaitMs: number;
  private readonly lockPollMs: number;
  private readonly lockTtlSeconds: number;

  constructor(
    private readonly redis: CacheClient,
    options: CacheOptions = {},
  ) {
    this.lockWaitMs = options.lockWaitMs ?? 5_000;
    this.lockPollMs = options.lockPollMs ?? 100;
    this.lockTtlSeconds = options.lockTtlSeconds ?? 30;
  }

  async getOrCompute<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const cached = await this.read<T>(key);
    if (cached !== undefined) return cached;

    const lockKey = `lock:${key}`;
    const locked = await this.acquire(lockKey);
    if (!locked) {
      // Someone else is computing this. Wait for their result rather than
      // stampeding the upstream, but never wait forever.
      const awaited = await this.waitFor<T>(key);
      if (awaited !== undefined) return awaited;
    }

    try {
      const value = await compute();
      await this.write(key, value, ttlSeconds);
      return value;
    } finally {
      if (locked) await this.safe(() => this.redis.del(lockKey));
    }
  }

  /** Overwrites the cached value directly, e.g. from a background refresh. */
  async set<T>(key: string, ttlSeconds: number, value: T): Promise<void> {
    await this.write(key, value, ttlSeconds);
  }

  /** Reads a cached value, or undefined on a miss or when Redis is unreachable. */
  async get<T>(key: string): Promise<T | undefined> {
    return this.read<T>(key);
  }

  private async read<T>(key: string): Promise<T | undefined> {
    const raw = await this.safe(() => this.redis.get(key));
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  private async write<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.safe(() => this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds));
  }

  private async acquire(lockKey: string): Promise<boolean> {
    const result = await this.safe(() =>
      this.redis.set(lockKey, '1', 'EX', this.lockTtlSeconds, 'NX'),
    );
    // A null reply means the key already existed, so the lock was not taken.
    // Redis being unreachable (safe returns undefined) means locks do not work,
    // so proceed to compute rather than block.
    return result !== null && result !== undefined;
  }

  private async waitFor<T>(key: string): Promise<T | undefined> {
    const deadline = Date.now() + this.lockWaitMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.lockPollMs));
      const value = await this.read<T>(key);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  /** Runs a Redis call, turning any failure into undefined so the cache never throws. */
  private async safe<T>(op: () => Promise<T>): Promise<T | undefined> {
    try {
      return await op();
    } catch {
      return undefined;
    }
  }
}
