import type { BlockscoutCache, BlockscoutCacheEntry } from './types.js';

export class InMemoryBlockscoutCache implements BlockscoutCache {
  private readonly entries = new Map<string, BlockscoutCacheEntry>();

  async get(key: string): Promise<BlockscoutCacheEntry | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, entry: BlockscoutCacheEntry): Promise<void> {
    this.entries.set(key, entry);
  }
}
