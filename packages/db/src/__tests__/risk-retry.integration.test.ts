import { DrizzleRiskRepository, type RiskScanRun, createDatabase } from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';

let database: ReturnType<typeof createDatabase>;
let available = false;

function scanRun(): Omit<RiskScanRun, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    chainId: 4663,
    targetType: 'token',
    targetAddress: '0x1000000000000000000000000000000000000001',
    engineVersion: 'engine-v1',
    rulesetVersion: 'ruleset-v1',
    methodologyVersion: 'risk-v1',
    sourceBlock: 100n,
    sourceBlockHash: `0x${'a'.repeat(64)}`,
    triggerType: 'new_token',
    idempotencyKey: `0x${'b'.repeat(64)}`,
    canonical: true,
    partial: false,
    status: 'running',
    startedAt: new Date('2026-07-15T12:00:00.000Z'),
    completedAt: null,
    errorCode: null,
    cancellationRequestedAt: null,
  };
}

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping risk retry integration tests');
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
    VALUES (4663, 'Robinhood Chain Test', 'ETH', true)
  `;
});

describe('risk scan retry claims', () => {
  it('reclaims a failed run once and keeps running work exclusive', async () => {
    if (!available) return;
    const repository = new DrizzleRiskRepository(database.db);
    const first = await repository.claimScanRun(scanRun());
    expect(first.claimed).toBe(true);

    await repository.updateScanRun(first.scanRun.id, {
      status: 'failed',
      partial: true,
      completedAt: new Date(),
      errorCode: 'SCAN_JOB_FAILURE',
    });

    const retry = await repository.claimScanRun(scanRun());
    expect(retry).toMatchObject({ claimed: true, scanRun: { status: 'running' } });
    expect(retry.scanRun.id).toBe(first.scanRun.id);

    const concurrent = await repository.claimScanRun(scanRun());
    expect(concurrent).toMatchObject({ claimed: false, scanRun: { status: 'running' } });
  });
});
