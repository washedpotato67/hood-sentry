import { describe, expect, it, vi } from 'vitest';
import { RetentionPruner } from './retention-pruner.js';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function pruner(options: {
  retentionBlocks: bigint;
  headBlock: bigint | null;
  deleted?: number[];
  zeroBalances?: number[];
  supersededFindings?: number[];
}): {
  instance: RetentionPruner;
  calls: Array<{ table: string; beforeBlock: bigint }>;
  vacuumed: string[];
} {
  const calls: Array<{ table: string; beforeBlock: bigint }> = [];
  const vacuumed: string[] = [];
  const zeroBalances = [...(options.zeroBalances ?? [])];
  const supersededFindings = [...(options.supersededFindings ?? [])];
  const queue = [...(options.deleted ?? [])];
  const instance = new RetentionPruner(
    {
      maxIndexedBlock: async () => options.headBlock,
      deleteOlderThan: async (table, beforeBlock) => {
        calls.push({ table, beforeBlock });
        return queue.length > 0 ? (queue.shift() ?? 0) : 0;
      },
      vacuum: async (table) => {
        vacuumed.push(table);
      },
      deleteZeroBalances: async () => zeroBalances.shift() ?? 0,
      deleteSupersededFindings: async () => supersededFindings.shift() ?? 0,
    },
    { retentionBlocks: options.retentionBlocks, deleteBatchSize: 1_000 },
    logger,
  );
  return { instance, calls, vacuumed };
}

describe('RetentionPruner', () => {
  it('does nothing when retention is disabled', async () => {
    const { instance, calls } = pruner({ retentionBlocks: 0n, headBlock: 500_000n });

    await instance.prune();

    expect(calls).toEqual([]);
  });

  it('does nothing before any block has been indexed', async () => {
    const { instance, calls } = pruner({ retentionBlocks: 100n, headBlock: null });

    await instance.prune();

    expect(calls).toEqual([]);
  });

  it('keeps the retention window and prunes only what precedes it', async () => {
    const { instance, calls } = pruner({ retentionBlocks: 100n, headBlock: 500_000n });

    await instance.prune();

    for (const call of calls) {
      expect(call.beforeBlock).toBe(499_900n);
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  it('deletes receipts before the transactions they reference', async () => {
    const { instance, calls } = pruner({ retentionBlocks: 100n, headBlock: 500_000n });

    await instance.prune();

    const order = calls.map((call) => call.table);
    expect(order.indexOf('transaction_receipts')).toBeLessThan(order.indexOf('transactions'));
  });

  it('prunes blocks last, after everything that describes them', async () => {
    const { instance, calls } = pruner({ retentionBlocks: 100n, headBlock: 500_000n });

    await instance.prune();

    const order = calls.map((call) => call.table);
    expect(order).toContain('blocks');
    expect(order.indexOf('blocks')).toBe(order.length - 1);
  });

  it('prunes nothing when the chain is younger than the retention window', async () => {
    const { instance, calls } = pruner({ retentionBlocks: 1_000n, headBlock: 500n });

    await instance.prune();

    expect(calls).toEqual([]);
  });

  it('removes zero balances, which record an absence rather than a holding', async () => {
    const { instance, vacuumed } = pruner({
      retentionBlocks: 100n,
      headBlock: 500_000n,
      zeroBalances: [400],
    });

    await instance.prune();

    expect(vacuumed).toContain('token_balances');
  });

  it('removes findings from scans a later scan replaced', async () => {
    const { instance, vacuumed } = pruner({
      retentionBlocks: 100n,
      headBlock: 500_000n,
      supersededFindings: [120],
    });

    await instance.prune();

    expect(vacuumed).toContain('risk_findings');
  });

  it('leaves the tables alone when there is nothing meaningless to remove', async () => {
    const { instance, vacuumed } = pruner({ retentionBlocks: 100n, headBlock: 500_000n });

    await instance.prune();

    expect(vacuumed).not.toContain('token_balances');
    expect(vacuumed).not.toContain('risk_findings');
  });

  it('reclaims space only for tables it actually deleted from', async () => {
    // One table returns a deleted count, the rest return zero.
    const { instance, vacuumed } = pruner({
      retentionBlocks: 100n,
      headBlock: 500_000n,
      deleted: [5],
    });

    await instance.prune();

    expect(vacuumed).toEqual(['transaction_receipts']);
  });
});
