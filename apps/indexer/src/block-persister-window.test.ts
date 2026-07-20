import type { Database } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import type { Block } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { BlockPersister } from './block-persister.js';
import type { BlockData, IndexerConfig } from './types.js';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

const config = { chainId: 4663n } as unknown as IndexerConfig;

function blockData(blockNumber: bigint): BlockData {
  return {
    block: {
      number: blockNumber,
      hash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
      parentHash: `0x${(blockNumber - 1n).toString(16).padStart(64, '0')}`,
      timestamp: 1_700_000_000n,
    } as unknown as Block,
    transactions: [],
    receipts: [],
    logs: [],
  };
}

/**
 * Counts transactions opened, which is what a round trip to the database costs
 * and the quantity this batching exists to reduce.
 */
function countingDatabase(): { database: Database; transactions: () => number } {
  let opened = 0;
  const tx = {
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
  };
  return {
    database: {
      db: {
        transaction: async (run: (handle: unknown) => Promise<void>) => {
          opened += 1;
          await run(tx);
        },
      },
    } as unknown as Database,
    transactions: () => opened,
  };
}

describe('persisting a window', () => {
  it('writes the whole window in a single transaction', async () => {
    const { database, transactions } = countingDatabase();
    const persister = new BlockPersister(database, config, logger);

    await persister.persistBlockWindow(
      [blockData(100n), blockData(101n), blockData(102n)],
      'finalized',
    );

    expect(transactions()).toBe(1);
  });

  it('still opens one transaction per block when persisted individually', async () => {
    const { database, transactions } = countingDatabase();
    const persister = new BlockPersister(database, config, logger);

    await persister.persistBlockData(blockData(100n), 'finalized');
    await persister.persistBlockData(blockData(101n), 'finalized');

    expect(transactions()).toBe(2);
  });

  it('opens no transaction for an empty window', async () => {
    const { database, transactions } = countingDatabase();
    const persister = new BlockPersister(database, config, logger);

    await persister.persistBlockWindow([], 'finalized');

    expect(transactions()).toBe(0);
  });
});
