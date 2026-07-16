import { type Database, createDatabase } from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import { createLogger } from '@hood-sentry/observability';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDerivedJobRouter } from '../derived-job-router.js';
import { DrizzleHolderBalanceSource } from '../jobs/drizzle-holder-balance-source.js';

/**
 * Balances are projected from canonical transfer history, so these tests exercise the
 * two properties that only appear against a real database: idempotence under
 * at-least-once delivery, and exclusion of transfers from abandoned forks.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';

const CHAIN_ID = 4663;
const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ALICE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BOB = '0xcccccccccccccccccccccccccccccccccccccccc';
const ZERO = '0x0000000000000000000000000000000000000000';

function hash(seed: string): string {
  return `0x${seed.repeat(64).slice(0, 64)}`;
}

const CANONICAL_BLOCK_HASH = hash('1');
const ORPHANED_BLOCK_HASH = hash('2');

let database: Database;
let route: ReturnType<typeof createDerivedJobRouter>;
let source: DrizzleHolderBalanceSource;
let available = false;

function transfer(input: {
  from: string;
  to: string;
  amount: string;
  blockNumber: string;
  logIndex: number;
  blockHash?: string;
  txSeed?: string;
}): DerivedJobPayload {
  return {
    type: 'token-transfer',
    chainId: String(CHAIN_ID),
    blockNumber: input.blockNumber,
    blockHash: input.blockHash ?? CANONICAL_BLOCK_HASH,
    data: {
      tokenAddress: TOKEN,
      fromAddress: input.from,
      toAddress: input.to,
      transactionHash: hash(input.txSeed ?? '3'),
      logIndex: input.logIndex,
      valueRaw: input.amount,
    },
  };
}

async function balanceOf(address: string): Promise<string | undefined> {
  const rows = await database.client`
    SELECT balance_raw FROM token_balances
    WHERE chain_id = ${CHAIN_ID} AND token_address = ${TOKEN}
      AND wallet_address = ${address.toLowerCase()}
  `;
  return rows[0]?.balance_raw as string | undefined;
}

/** Registers a block so transfers can derive canonicality from it. */
async function insertBlock(number: number, blockHash: string, canonical: boolean): Promise<void> {
  await database.client`
    INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
    VALUES (${CHAIN_ID}, ${number}, ${blockHash}, ${hash('0')}, NOW(), 'finalized', ${canonical})
    ON CONFLICT DO NOTHING
  `;
}

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping balance projection tests');
  } finally {
    await probe.close();
  }
});

afterAll(async () => {
  if (database) await database.close();
});

beforeEach(async ({ skip }) => {
  skip(!available, 'PostgreSQL is unavailable');
  if (database) await database.close();
  database = createDatabase(TEST_DATABASE_URL);
  await resetAndMigrate(database.client);
  await database.client`
    INSERT INTO chains (chain_id, name, native_symbol, enabled)
    VALUES (${CHAIN_ID}, 'Robinhood Chain Test', 'ETH', true)
  `;
  await insertBlock(10, CANONICAL_BLOCK_HASH, true);
  route = createDerivedJobRouter(
    createLogger({ level: 'fatal', service: 'worker-test' }),
    database,
    {
      poolRefresh: {
        async run() {
          throw new Error('Pool refresh was not expected in this test');
        },
      },
      riskAnalysis: {
        async run() {
          throw new Error('Risk analysis was not expected in this test');
        },
      },
      riskAlerts: {
        async evaluate() {},
      },
      chainReader: {
        async getBytecode() {
          throw new Error('Token metadata was not expected in this test');
        },
        async readContract() {
          throw new Error('Token metadata was not expected in this test');
        },
      },
      protocolEnrichment: {
        async run() {
          throw new Error('Protocol enrichment was not expected in this test');
        },
      },
    },
  );
  source = new DrizzleHolderBalanceSource(database);
});

describe('token balance projection', () => {
  it('credits the recipient and debits the sender', async () => {
    if (!available) return;
    // Mint 1000 to Alice, then Alice sends 400 to Bob.
    await route(
      transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 }),
    );
    await route(
      transfer({
        from: ALICE,
        to: BOB,
        amount: '400',
        blockNumber: '10',
        logIndex: 1,
        txSeed: '4',
      }),
    );

    expect(await balanceOf(ALICE)).toBe('600');
    expect(await balanceOf(BOB)).toBe('400');
  });

  it('does not record the zero address as a holder', async () => {
    if (!available) return;
    await route(
      transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 }),
    );

    // Minting would otherwise leave the zero address holding a negative balance.
    expect(await balanceOf(ZERO)).toBeUndefined();
  });

  it('is idempotent when the same transfer is redelivered', async () => {
    if (!available) return;
    const job = transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 });
    await route(job);
    await route(job);
    await route(job);

    // Recomputing from history means redelivery cannot double-count.
    expect(await balanceOf(ALICE)).toBe('1000');
  });

  it('excludes a transfer whose block is already orphaned when the job lands', async () => {
    if (!available) return;
    await insertBlock(11, ORPHANED_BLOCK_HASH, false);

    await route(
      transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 }),
    );
    // This job was published before the reorg and arrives after it.
    await route(
      transfer({
        from: ZERO,
        to: ALICE,
        amount: '5000',
        blockNumber: '11',
        logIndex: 0,
        blockHash: ORPHANED_BLOCK_HASH,
        txSeed: '5',
      }),
    );

    const rows = await database.client`
      SELECT canonical FROM token_transfers
      WHERE chain_id = ${CHAIN_ID} AND block_number = 11
    `;
    expect(rows[0]?.canonical, 'a transfer on an orphaned block is not canonical').toBe(false);
    expect(await balanceOf(ALICE), 'orphaned transfer must not credit the holder').toBe('1000');
  });

  it('drops a reorged transfer from the balance when it is reprojected', async () => {
    if (!available) return;
    await insertBlock(11, ORPHANED_BLOCK_HASH, true);
    await route(
      transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 }),
    );
    await route(
      transfer({
        from: ZERO,
        to: ALICE,
        amount: '5000',
        blockNumber: '11',
        logIndex: 0,
        blockHash: ORPHANED_BLOCK_HASH,
        txSeed: '5',
      }),
    );
    expect(await balanceOf(ALICE)).toBe('6000');

    // The indexer's reorg path invalidates the fork's transfers.
    await database.client`
      UPDATE token_transfers SET canonical = false
      WHERE chain_id = ${CHAIN_ID} AND block_number = 11
    `;
    await route(
      transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 }),
    );

    expect(await balanceOf(ALICE), 'balance must shed the abandoned fork').toBe('1000');
  });

  it('ignores an orphaned transfer when reporting the latest transfer block', async () => {
    if (!available) return;
    await insertBlock(11, ORPHANED_BLOCK_HASH, true);
    await route(
      transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 }),
    );
    await route(
      transfer({
        from: ZERO,
        to: ALICE,
        amount: '5000',
        blockNumber: '11',
        logIndex: 0,
        blockHash: ORPHANED_BLOCK_HASH,
        txSeed: '5',
      }),
    );
    await database.client`
      UPDATE token_transfers SET canonical = false
      WHERE chain_id = ${CHAIN_ID} AND block_number = 11
    `;

    // Otherwise the orphaned block would make balances look stale forever.
    expect(await source.latestTransferBlock(CHAIN_ID, TOKEN, 100n)).toBe(10n);
  });

  it('records the block a balance is accurate as of', async () => {
    if (!available) return;
    await route(
      transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 }),
    );

    const balances = await source.listBalances(CHAIN_ID, TOKEN);
    expect(balances).toHaveLength(1);
    expect(balances[0]?.asOfBlock).toBe(10n);
    expect(balances[0]?.balanceRaw).toBe(1000n);
  });

  it('feeds holder balances the risk scan can pin', async () => {
    if (!available) return;
    await route(
      transfer({ from: ZERO, to: ALICE, amount: '1000', blockNumber: '10', logIndex: 0 }),
    );
    await route(
      transfer({
        from: ALICE,
        to: BOB,
        amount: '400',
        blockNumber: '10',
        logIndex: 1,
        txSeed: '4',
      }),
    );

    const balances = await source.listBalances(CHAIN_ID, TOKEN);
    const latest = await source.latestTransferBlock(CHAIN_ID, TOKEN, 10n);
    const highestAsOf = balances.reduce(
      (highest, b) => (b.asOfBlock > highest ? b.asOfBlock : highest),
      0n,
    );

    // The projection keeps balances level with the transfers that produced them, which
    // is what lets a scan at that block treat them as pinned.
    expect(latest).toBe(highestAsOf);
  });
});
