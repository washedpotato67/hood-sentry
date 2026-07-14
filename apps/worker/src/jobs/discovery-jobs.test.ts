import type { DiscoveryCandidate, DiscoveryItem } from '@hood-sentry/discovery-engine';
import { describe, expect, it } from 'vitest';
import { DiscoveryRefreshJob } from './discovery-refresh.js';
import { DiscoveryReorgJob } from './discovery-reorg.js';

describe('discovery jobs', () => {
  it('uses a block-bound idempotency key when indexed data is absent', async () => {
    const job = new DiscoveryRefreshJob(
      { loadCandidate: async (): Promise<DiscoveryCandidate | null> => null },
      { saveSnapshot: async (_item: DiscoveryItem) => undefined },
    );
    await expect(
      job.run({
        chainId: 4663,
        tokenAddress: '0x0000000000000000000000000000000000000001',
        sourceBlockNumber: 50n,
      }),
    ).resolves.toEqual({
      item: null,
      idempotencyKey: 'discovery-refresh:4663:0x0000000000000000000000000000000000000001:50',
    });
  });

  it('rejects malformed queue input before reading indexed data', async () => {
    let loaded = false;
    const job = new DiscoveryRefreshJob(
      {
        loadCandidate: async (): Promise<DiscoveryCandidate | null> => {
          loaded = true;
          return null;
        },
      },
      { saveSnapshot: async (_item: DiscoveryItem) => undefined },
    );
    await expect(
      job.run({ chainId: 4663, tokenAddress: 'not-an-address', sourceBlockNumber: 50n }),
    ).rejects.toThrow('Token address is malformed');
    expect(loaded).toBe(false);
  });

  it('invalidates and republishes a reorg range', async () => {
    const invalidated: string[] = [];
    const republished: string[] = [];
    const job = new DiscoveryReorgJob(
      {
        markNonCanonical: async (chainId, fromBlock, toBlock) => {
          invalidated.push(`${chainId}:${fromBlock.toString()}:${toBlock.toString()}`);
        },
      },
      {
        publishDiscoveryRecompute: async ({ chainId, fromBlock, toBlock }) => {
          republished.push(`${chainId}:${fromBlock.toString()}:${toBlock.toString()}`);
        },
      },
    );
    await expect(job.run({ chainId: 4663, fromBlock: 10n, toBlock: 12n })).resolves.toEqual({
      idempotencyKey: 'discovery-reorg:4663:10:12',
    });
    expect(invalidated).toEqual(['4663:10:12']);
    expect(republished).toEqual(['4663:10:12']);
  });
});
