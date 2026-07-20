import { describe, expect, it, vi } from 'vitest';
import { PoolBackfill } from './pool-backfill.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function pairAddress(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(40, '0')}` as `0x${string}`;
}

function buildBackfill(options: {
  total: number;
  known?: Set<string>;
  cursor?: number;
  batchSize?: number;
}) {
  const written: Array<{ address: string; token0: string; token1: string }> = [];
  let savedCursor = options.cursor ?? 0;
  const backfill = new PoolBackfill(
    {
      totalPairs: async () => BigInt(options.total),
      pairAtIndex: async (index) => pairAddress(Number(index)),
      pairTokens: async (address) => ({
        token0: `0xaaaa${address.slice(6)}` as `0x${string}`,
        token1: `0xbbbb${address.slice(6)}` as `0x${string}`,
      }),
    },
    {
      knownPoolAddresses: async () => options.known ?? new Set<string>(),
      insertPools: async (rows) => {
        for (const row of rows) written.push(row);
        return rows.length;
      },
      readCursor: async () => savedCursor,
      writeCursor: async (next) => {
        savedCursor = next;
      },
    },
    { batchSize: options.batchSize ?? 5 },
    logger,
  );
  return { backfill, written, cursor: () => savedCursor };
}

describe('PoolBackfill', () => {
  it('enumerates every pair the factory reports', async () => {
    const { backfill, written } = buildBackfill({ total: 12 });

    await backfill.run();

    expect(written).toHaveLength(12);
    expect(written[0]?.address).toBe(pairAddress(0));
    expect(written[11]?.address).toBe(pairAddress(11));
  });

  it('skips pairs already indexed so a rerun costs nothing', async () => {
    const known = new Set([pairAddress(0).toLowerCase(), pairAddress(1).toLowerCase()]);
    const { backfill, written } = buildBackfill({ total: 4, known });

    await backfill.run();

    expect(written.map((row) => row.address)).toEqual([pairAddress(2), pairAddress(3)]);
  });

  it('records progress so an interrupted run resumes instead of restarting', async () => {
    const { backfill, cursor } = buildBackfill({ total: 10, batchSize: 5 });

    await backfill.run();

    expect(cursor()).toBe(10);
  });

  it('resumes from a stored cursor rather than re-reading the whole factory', async () => {
    const { backfill, written } = buildBackfill({ total: 8, cursor: 6 });

    await backfill.run();

    expect(written.map((row) => row.address)).toEqual([pairAddress(6), pairAddress(7)]);
  });

  it('does nothing when the factory has no pairs', async () => {
    const { backfill, written } = buildBackfill({ total: 0 });

    await backfill.run();

    expect(written).toEqual([]);
  });

  it('keeps going when a single pair cannot be read', async () => {
    const written: Array<{ address: string }> = [];
    const backfill = new PoolBackfill(
      {
        totalPairs: async () => 3n,
        pairAtIndex: async (index) => pairAddress(Number(index)),
        pairTokens: async (address) => {
          // A pair that does not answer must not abandon the remaining ones.
          if (address === pairAddress(1)) throw new Error('reverted');
          return { token0: '0xaaa' as `0x${string}`, token1: '0xbbb' as `0x${string}` };
        },
      },
      {
        knownPoolAddresses: async () => new Set<string>(),
        insertPools: async (rows) => {
          for (const row of rows) written.push(row);
          return rows.length;
        },
        readCursor: async () => 0,
        writeCursor: async () => undefined,
      },
      { batchSize: 5 },
      logger,
    );

    await backfill.run();

    expect(written.map((row) => row.address)).toEqual([pairAddress(0), pairAddress(2)]);
  });
});
