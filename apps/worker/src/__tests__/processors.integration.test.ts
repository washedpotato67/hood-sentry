import { type Database, createDatabase } from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import { createLogger } from '@hood-sentry/observability';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDerivedJobRouter } from '../derived-job-router.js';

/**
 * Derived jobs are delivered at least once and processed concurrently, so every
 * processor has to be idempotent and independent of arrival order. These tests
 * assert exactly that against a live database.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';

const CHAIN_ID = 4663;

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SPENDER = '0xcccccccccccccccccccccccccccccccccccccccc';
const RECIPIENT = '0xdddddddddddddddddddddddddddddddddddddddd';
const CREATOR = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function hash(seed: string): string {
  return `0x${seed.repeat(64).slice(0, 64)}`;
}

let database: Database;
let route: ReturnType<typeof createDerivedJobRouter>;
let available = false;

function job(overrides: Partial<DerivedJobPayload> = {}): DerivedJobPayload {
  return {
    type: 'token-transfer',
    chainId: String(CHAIN_ID),
    blockNumber: '100',
    blockHash: hash('b'),
    data: {},
    ...overrides,
  };
}

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping worker processor tests');
  } finally {
    await probe.close();
  }
});

afterAll(async () => {
  if (database) await database.close();
});

beforeEach(async () => {
  if (!available) return;
  if (database) await database.close();
  database = createDatabase(TEST_DATABASE_URL);
  await resetAndMigrate(database.client);
  await database.client`
    INSERT INTO chains (chain_id, name, native_symbol, enabled)
    VALUES (${CHAIN_ID}, 'Robinhood Chain Test', 'ETH', true)
  `;
  route = createDerivedJobRouter(
    createLogger({ level: 'fatal', service: 'worker-test' }),
    database,
  );
});

describe('token-transfer processor', () => {
  const transfer = (logIndex: number, amount: string) =>
    job({
      type: 'token-transfer',
      data: {
        tokenAddress: TOKEN,
        fromAddress: OWNER,
        toAddress: RECIPIENT,
        transactionHash: hash('1'),
        logIndex,
        valueRaw: amount,
      },
    });

  it('records a transfer', async () => {
    if (!available) return;
    await route(transfer(0, '1000'));

    const rows = await database.client`SELECT * FROM token_transfers WHERE chain_id = ${CHAIN_ID}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount_raw).toBe('1000');
    expect(rows[0]?.token_address).toBe(TOKEN);
  });

  it('collapses a redelivered job onto the same row', async () => {
    if (!available) return;
    await route(transfer(0, '1000'));
    await route(transfer(0, '1000'));
    await route(transfer(0, '1000'));

    const rows = await database.client`SELECT * FROM token_transfers WHERE chain_id = ${CHAIN_ID}`;
    expect(rows, 'at-least-once delivery must not duplicate a transfer').toHaveLength(1);
  });

  it('keeps distinct logs in the same transaction apart', async () => {
    if (!available) return;
    await route(transfer(0, '1000'));
    await route(transfer(1, '2000'));

    const rows = await database.client`
      SELECT amount_raw FROM token_transfers WHERE chain_id = ${CHAIN_ID} ORDER BY log_index
    `;
    expect(rows.map((r) => r.amount_raw)).toEqual(['1000', '2000']);
  });

  it('rejects a malformed payload so it is retried, not swallowed', async () => {
    if (!available) return;
    await expect(
      route(job({ type: 'token-transfer', data: { tokenAddress: 'not-an-address' } })),
    ).rejects.toThrow();

    const rows = await database.client`SELECT * FROM token_transfers WHERE chain_id = ${CHAIN_ID}`;
    expect(rows).toHaveLength(0);
  });
});

describe('token-approval processor', () => {
  const approval = (blockNumber: string, logIndex: number, amount: string) =>
    job({
      type: 'token-approval',
      blockNumber,
      data: {
        tokenAddress: TOKEN,
        ownerAddress: OWNER,
        spenderAddress: SPENDER,
        transactionHash: hash('2'),
        logIndex,
        valueRaw: amount,
      },
    });

  async function allowance(): Promise<string | undefined> {
    const rows = await database.client`
      SELECT allowance_raw FROM token_approvals WHERE chain_id = ${CHAIN_ID}
    `;
    return rows[0]?.allowance_raw as string | undefined;
  }

  it('records the latest allowance', async () => {
    if (!available) return;
    await route(approval('100', 0, '500'));
    expect(await allowance()).toBe('500');

    await route(approval('101', 0, '900'));
    expect(await allowance()).toBe('900');
  });

  it('ignores an approval that arrives out of order', async () => {
    if (!available) return;
    await route(approval('101', 0, '900'));
    // A stale job redelivered after the newer one must not roll the allowance back.
    await route(approval('100', 0, '500'));

    expect(await allowance(), 'an older approval must not overwrite a newer one').toBe('900');
  });

  it('orders two approvals inside one block by log index', async () => {
    if (!available) return;
    await route(approval('100', 1, '900'));
    await route(approval('100', 0, '500'));

    expect(await allowance(), 'later log in the same block wins').toBe('900');
  });

  it('is idempotent on redelivery', async () => {
    if (!available) return;
    await route(approval('100', 0, '500'));
    await route(approval('100', 0, '500'));

    const rows = await database.client`SELECT * FROM token_approvals WHERE chain_id = ${CHAIN_ID}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.allowance_raw).toBe('500');
  });
});

describe('contract-creation processor', () => {
  const creation = (address: string) =>
    job({
      type: 'contract-creation',
      data: {
        contractAddress: address,
        creatorAddress: CREATOR,
        transactionHash: hash('3'),
        nonce: '1',
      },
    });

  it('records a deployed contract', async () => {
    if (!available) return;
    await route(creation(TOKEN));

    const rows = await database.client`SELECT * FROM contracts WHERE chain_id = ${CHAIN_ID}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.address).toBe(TOKEN);
    expect(rows[0]?.creator_address).toBe(CREATOR);
    expect(rows[0]?.creation_block).toBe('100');
  });

  it('does not overwrite enrichment when the job is redelivered', async () => {
    if (!available) return;
    await route(creation(TOKEN));
    // Enrichment that a later pipeline owns.
    await database.client`
      UPDATE contracts SET verified = true, is_proxy = true WHERE chain_id = ${CHAIN_ID}
    `;

    await route(creation(TOKEN));

    const rows = await database.client`SELECT * FROM contracts WHERE chain_id = ${CHAIN_ID}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verified, 'a replay must not clobber enrichment').toBe(true);
    expect(rows[0]?.is_proxy).toBe(true);
  });
});

describe('router', () => {
  it('dead-letters an unrecognised type rather than dropping it', async () => {
    if (!available) return;
    await expect(route(job({ type: 'not-a-real-type' }))).rejects.toThrow(/Unrecognised/);
  });

  it('acknowledges a known type that has no processor yet', async () => {
    if (!available) return;
    await expect(route(job({ type: 'market-metric' }))).resolves.toBeUndefined();
  });
});
