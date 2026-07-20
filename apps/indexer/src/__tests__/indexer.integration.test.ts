import type { Database } from '@hood-sentry/db';
import { createLogger } from '@hood-sentry/observability';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BlockPersister } from '../block-persister.js';
import {
  CHAIN_ID_SQL,
  buildIndexer,
  createTestDatabase,
  isDatabaseAvailable,
  runLiveUntil,
  testConfig,
  waitFor,
} from './harness.js';
import { SyntheticChain, syntheticHash } from './synthetic-chain.js';

/**
 * End-to-end indexer tests against a live Postgres. These exercise the failure
 * modes that only appear once real persistence is involved: reorgs, restarts,
 * lease contention, gap repair, and malformed RPC responses.
 */

let database: Database;
let available = false;

beforeAll(async () => {
  available = await isDatabaseAvailable();
  if (!available) {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping indexer integration tests');
  }
});

afterAll(async () => {
  if (database) await database.close();
});

beforeEach(async ({ skip }) => {
  skip(!available, 'PostgreSQL is unavailable');
  if (database) await database.close();
  database = await createTestDatabase();
});

async function blockRows(): Promise<
  Array<{ number: string; hash: string; canonical: boolean; finality_state: string }>
> {
  const rows = await database.client`
    SELECT number::text, hash, canonical, finality_state
    FROM blocks WHERE chain_id = ${CHAIN_ID_SQL} ORDER BY number, hash
  `;
  return rows as unknown as Array<{
    number: string;
    hash: string;
    canonical: boolean;
    finality_state: string;
  }>;
}

async function canonicalNumbers(): Promise<string[]> {
  const rows = await database.client`
    SELECT number::text FROM blocks
    WHERE chain_id = ${CHAIN_ID_SQL} AND canonical = true ORDER BY number
  `;
  return rows.map((row) => row.number as string);
}

describe('indexer synthetic reorg', () => {
  it('orphans the abandoned fork and reindexes the winning fork', async () => {
    if (!available) return;

    const chain = new SyntheticChain(6, 'a');
    const first = buildIndexer(database, chain);
    await runLiveUntil(
      first.indexer,
      async () => (await canonicalNumbers()).length === 6,
      'initial chain indexed',
    );

    const beforeReorg = await blockRows();
    expect(beforeReorg).toHaveLength(6);

    // ERC-20 transfers are derived from these blocks by the worker, so they must be
    // invalidated along with the fork they came from.
    for (const height of [2n, 3n, 4n, 5n]) {
      await database.client`
        INSERT INTO token_transfers (
          chain_id, block_number, block_hash, transaction_hash, log_index,
          token_address, from_address, to_address, amount_raw
        ) VALUES (
          ${CHAIN_ID_SQL}, ${Number(height)}, ${syntheticHash(`a-block-${height}`)},
          ${syntheticHash(`a-tx-${height}-0`)}, 0,
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          '0xcccccccccccccccccccccccccccccccccccccccc', 1000
        )
      `;
    }

    // The chain rewrites heights 3-5 onto a new fork and extends to 6.
    chain.reorgFrom(3n, 6n, 'b');

    const second = buildIndexer(database, chain);
    await runLiveUntil(
      second.indexer,
      async () => {
        const checkpoint = await second.checkpointManager.getCheckpoint('live-4663');
        return checkpoint?.nextBlock === 7n;
      },
      'reorg reconciled and new fork indexed',
    );

    const reorgs = await database.client`
      SELECT from_block::text, to_block::text, common_ancestor_block::text,
             blocks_orphaned, resolved_at
      FROM reorg_events WHERE chain_id = ${CHAIN_ID_SQL}
    `;
    expect(reorgs).toHaveLength(1);
    expect(reorgs[0]?.from_block).toBe('3');
    expect(reorgs[0]?.to_block).toBe('5');
    expect(reorgs[0]?.common_ancestor_block).toBe('2');
    expect(reorgs[0]?.resolved_at).not.toBeNull();

    // Heights 0-2 are untouched; the fork-a copies of 3-5 are orphaned and the
    // fork-b blocks replace them as canonical.
    for (const height of [3n, 4n, 5n]) {
      const orphanedHash = syntheticHash(`a-block-${height}`);
      const row = (await blockRows()).find((b) => b.hash === orphanedHash);
      expect(row?.canonical, `fork-a block ${height} should be orphaned`).toBe(false);
      expect(row?.finality_state).toBe('orphaned');
    }

    expect(await canonicalNumbers()).toEqual(['0', '1', '2', '3', '4', '5', '6']);

    // Derived facts from the abandoned fork must not stay canonical.
    const abandonedHashes = [3n, 4n, 5n].map((height) => syntheticHash(`a-block-${height}`));
    const staleTxs = await database.client`
      SELECT COUNT(*)::int AS count FROM transactions
      WHERE chain_id = ${CHAIN_ID_SQL}
        AND block_hash = ANY(${abandonedHashes}) AND canonical = true
    `;
    expect(staleTxs[0]?.count, 'fork-a transactions must not stay canonical').toBe(0);

    const staleLogs = await database.client`
      SELECT COUNT(*)::int AS count FROM logs
      WHERE chain_id = ${CHAIN_ID_SQL}
        AND block_hash = ANY(${abandonedHashes}) AND canonical = true
    `;
    expect(staleLogs[0]?.count, 'fork-a logs must not stay canonical').toBe(0);

    // The replacement fork's facts are canonical in their place.
    const winningHashes = [3n, 4n, 5n, 6n].map((height) => syntheticHash(`b-block-${height}`));
    const winningTxs = await database.client`
      SELECT COUNT(*)::int AS count FROM transactions
      WHERE chain_id = ${CHAIN_ID_SQL}
        AND block_hash = ANY(${winningHashes}) AND canonical = true
    `;
    expect(winningTxs[0]?.count).toBe(4);

    // Transfers from the abandoned fork must stop counting; the one below the common
    // ancestor is untouched.
    const transfers = await database.client`
      SELECT block_number::text, canonical FROM token_transfers
      WHERE chain_id = ${CHAIN_ID_SQL} ORDER BY block_number
    `;
    expect(transfers.map((row) => [row.block_number, row.canonical])).toEqual([
      ['2', true],
      ['3', false],
      ['4', false],
      ['5', false],
    ]);
  });
});

describe('indexer restart', () => {
  it('resumes from its checkpoint without refetching or duplicating blocks', async () => {
    if (!available) return;

    const chain = new SyntheticChain(4, 'a');
    const first = buildIndexer(database, chain);
    await runLiveUntil(
      first.indexer,
      async () => (await canonicalNumbers()).length === 4,
      'first run indexed 0-3',
    );

    const checkpoint = await first.checkpointManager.getCheckpoint('live-4663');
    expect(checkpoint?.nextBlock).toBe(4n);
    expect(checkpoint?.lastBlockHash).toBe(syntheticHash('a-block-3'));

    // The chain advances while the indexer is down, then a fresh process starts.
    chain.extendTo(6n, 'a');
    const second = buildIndexer(database, chain);
    await runLiveUntil(
      second.indexer,
      async () => (await canonicalNumbers()).length === 7,
      'restarted run indexed 4-6',
    );

    expect(await canonicalNumbers()).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(second.indexer.getStatus().metrics.blocksIndexed).toBe(3);

    // Resuming means the already-persisted heights are never fetched again.
    expect(second.rpc.blockFetches).not.toContain(0n);
    expect(second.rpc.blockFetches).not.toContain(3n);
    expect(second.rpc.blockFetches).toContain(4n);

    const totalRows = await database.client`
      SELECT COUNT(*)::int AS count FROM blocks WHERE chain_id = ${CHAIN_ID_SQL}
    `;
    expect(totalRows[0]?.count).toBe(7);
  });
});

describe('indexer lease contention', () => {
  it('refuses to start a second indexer while another holds the lease', async () => {
    if (!available) return;

    const chain = new SyntheticChain(4, 'a');
    const holder = buildIndexer(database, chain, { workerId: 'worker-a' });
    let holderError: unknown;
    const holderRun = holder.indexer.start().catch((error: unknown) => {
      holderError = error;
    });

    try {
      await waitFor(async () => (await canonicalNumbers()).length > 0, 10_000, 'holder indexing');

      const contender = buildIndexer(database, chain, { workerId: 'worker-b' });
      await expect(contender.indexer.start()).rejects.toThrow(/lease/i);

      const leases = await database.client`
        SELECT worker_id FROM indexer_leases
        WHERE chain_id = ${CHAIN_ID_SQL} AND stream = 'live-4663'
      `;
      expect(leases).toHaveLength(1);
      expect(leases[0]?.worker_id).toBe('worker-a');
    } finally {
      await holder.indexer.stop();
      await holderRun;
    }
    expect(holderError).toBeUndefined();
  });

  it('stops when its lease is revoked instead of retrying in place forever', async () => {
    if (!available) return;

    const chain = new SyntheticChain(4, 'a');
    const holder = buildIndexer(database, chain, { workerId: 'worker-a' });
    let runError: unknown;
    const run = holder.indexer.start().catch((error: unknown) => {
      runError = error;
    });

    try {
      await waitFor(async () => (await canonicalNumbers()).length > 0, 10_000, 'holder indexing');

      // Revoking the lease is how a checkpoint is moved by hand. The loop must
      // surface that rather than swallow it: retrying in place never re-reads
      // the checkpoint, so the indexer would spin on the old position forever.
      await database.client`
        DELETE FROM indexer_leases
        WHERE chain_id = ${CHAIN_ID_SQL} AND stream = 'live-4663'
      `;

      await waitFor(() => runError !== undefined, 10_000, 'lease loss to surface');
      expect(String(runError)).toMatch(/lease/i);
    } finally {
      await holder.indexer.stop();
      await run;
    }
  });

  it('takes over a lease that has expired', async () => {
    if (!available) return;

    const chain = new SyntheticChain(2, 'a');
    // A crashed worker leaves an expired lease behind.
    await database.client`
      INSERT INTO indexer_leases (chain_id, stream, worker_id, expires_at)
      VALUES (${CHAIN_ID_SQL}, 'live-4663', 'crashed-worker', NOW() - INTERVAL '1 minute')
    `;

    const successor = buildIndexer(database, chain, { workerId: 'worker-b' });
    const lease = await successor.checkpointManager.acquireLease('live-4663');
    expect(lease?.workerId).toBe('worker-b');

    const leases = await database.client`
      SELECT worker_id FROM indexer_leases
      WHERE chain_id = ${CHAIN_ID_SQL} AND stream = 'live-4663'
    `;
    expect(leases).toHaveLength(1);
    expect(leases[0]?.worker_id).toBe('worker-b');
  });
});

describe('indexer gap repair', () => {
  it('detects and backfills only the missing heights', async () => {
    if (!available) return;

    const chain = new SyntheticChain(7, 'a');
    const config = testConfig({ mode: 'gap-repair', startBlock: 0n, endBlock: 6n });
    const logger = createLogger({ level: 'fatal', service: 'indexer-test' });
    const persister = new BlockPersister(database, config, logger);

    // Heights 3 and 4 never landed, leaving a hole between 2 and 5.
    for (const height of [0n, 1n, 2n, 5n, 6n]) {
      await persister.persistBlockData(chain.blockAt(height), 'finalized', true);
    }
    expect(await canonicalNumbers()).toEqual(['0', '1', '2', '5', '6']);

    const repair = buildIndexer(database, chain, {
      mode: 'gap-repair',
      startBlock: 0n,
      endBlock: 6n,
    });
    await repair.indexer.start();

    expect(await canonicalNumbers()).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(repair.indexer.getStatus().metrics.gapsFound).toBe(1);
    expect(repair.indexer.getStatus().metrics.blocksIndexed).toBe(2);

    // Only the repaired heights are refetched and republished.
    expect(repair.rpc.blockFetches.sort()).toEqual([3n, 4n]);
    const publishedBlocks = repair.publisher.published.map((p) => p.job.blockNumber);
    expect(new Set(publishedBlocks)).toEqual(new Set([3n, 4n]));
  });
});

describe('indexer malformed RPC responses', () => {
  it('retries a transient provider outage and leaves no gap', async () => {
    if (!available) return;

    const chain = new SyntheticChain(4, 'a');
    const indexer = buildIndexer(
      database,
      chain,
      {},
      { throwOnBlock: new Set([2n]), maxFaults: 1 },
    );

    await runLiveUntil(
      indexer.indexer,
      async () => (await canonicalNumbers()).length === 4,
      'recovered from provider outage',
    );

    expect(await canonicalNumbers()).toEqual(['0', '1', '2', '3']);
    expect(indexer.indexer.getStatus().errors.length).toBeGreaterThan(0);
  });

  it('waits for a block the provider does not have yet', async () => {
    if (!available) return;

    const chain = new SyntheticChain(3, 'a');
    const indexer = buildIndexer(database, chain, {}, { nullOnBlock: new Set([1n]), maxFaults: 2 });

    await runLiveUntil(
      indexer.indexer,
      async () => (await canonicalNumbers()).length === 3,
      'indexed after block became available',
    );

    expect(await canonicalNumbers()).toEqual(['0', '1', '2']);
  });

  it('does not persist a block whose receipts failed to load', async () => {
    if (!available) return;

    const chain = new SyntheticChain(3, 'a');
    const failingTx = chain.blockAt(1n).transactions[0]?.hash;
    if (failingTx === undefined) throw new Error('fixture is missing a transaction');

    const indexer = buildIndexer(
      database,
      chain,
      {},
      { throwOnReceipt: new Set([failingTx]), maxFaults: 1 },
    );

    await runLiveUntil(
      indexer.indexer,
      async () => (await canonicalNumbers()).length === 3,
      'recovered from receipt failure',
    );

    // A receipt failure must not leave a block persisted without its logs.
    const logs = await database.client`
      SELECT COUNT(*)::int AS count FROM logs
      WHERE chain_id = ${CHAIN_ID_SQL} AND block_number = 1
    `;
    expect(logs[0]?.count).toBe(1);
  });

  it('does not advance the checkpoint past a malformed block', async () => {
    if (!available) return;

    const chain = new SyntheticChain(4, 'a');
    const indexer = buildIndexer(
      database,
      chain,
      {},
      { malformedOnBlock: new Set([2n]), maxFaults: 1 },
    );

    await runLiveUntil(
      indexer.indexer,
      async () => (await canonicalNumbers()).length === 4,
      'recovered from malformed block',
    );

    // Block 2 must be indexed, not skipped: a malformed response is an error to
    // retry, never a reason to move the checkpoint forward.
    expect(await canonicalNumbers()).toEqual(['0', '1', '2', '3']);
    const checkpoint = await indexer.checkpointManager.getCheckpoint('live-4663');
    expect(checkpoint?.nextBlock).toBe(4n);
  });
});
