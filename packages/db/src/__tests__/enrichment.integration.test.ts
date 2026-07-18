import {
  DrizzleProtocolRepositoryImpl,
  DrizzleRiskRepository,
  createDatabase,
} from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';

const CHAIN_ID = 4663;

let database: ReturnType<typeof createDatabase>;
let available = false;

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping feed-enrichment integration tests');
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
});

// Insert a scan run and return its id. Only the columns the enrichment query
// touches are set explicitly; the rest ride migration defaults.
async function insertScan(opts: {
  targetAddress: string;
  canonical: boolean;
  createdAt: string;
}): Promise<string> {
  const rows = await database.client<{ id: string }[]>`
    INSERT INTO risk_scan_runs
      (chain_id, target_address, target_type, engine_version, ruleset_version,
       source_block, status, canonical, created_at)
    VALUES
      (${CHAIN_ID}, ${opts.targetAddress}, 'token', 'engine-v1', 'ruleset-v1',
       100, 'completed', ${opts.canonical}, ${opts.createdAt})
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('scan insert returned no id');
  return id;
}

async function insertFinding(opts: {
  scanRunId: string;
  severity: string;
  suppressed?: boolean;
}): Promise<void> {
  await database.client`
    INSERT INTO risk_findings
      (scan_run_id, rule_id, rule_version, category, severity, confidence,
       title, explanation, evidence, source_provenance, fingerprint, suppressed)
    VALUES
      (${opts.scanRunId}, 'rule-1', 'v1', 'liquidity', ${opts.severity}, 0.9,
       'Finding', 'Because evidence', '{}'::jsonb, '{}'::jsonb,
       ${`fp-${opts.severity}-${Math.random()}`}, ${opts.suppressed ?? false})
  `;
}

describe('RiskRepository.getFindingSeverityCounts', () => {
  it('buckets only the latest canonical scan, skips suppressed, keys by lowercase', async () => {
    if (!available) return;
    const repository = new DrizzleRiskRepository(database.db);
    // Stored target is mixed-case; the feed will ask with a checksummed address.
    const tokenA = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa0001';
    const tokenAddressLower = tokenA.toLowerCase();

    // An older canonical scan whose findings must be superseded.
    const oldScan = await insertScan({
      targetAddress: tokenA,
      canonical: true,
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    await insertFinding({ scanRunId: oldScan, severity: 'high' });
    await insertFinding({ scanRunId: oldScan, severity: 'high' });

    // The latest canonical scan — the only one that should be counted.
    const newScan = await insertScan({
      targetAddress: tokenA,
      canonical: true,
      createdAt: '2026-07-15T00:00:00.000Z',
    });
    await insertFinding({ scanRunId: newScan, severity: 'critical' }); // high bucket
    await insertFinding({ scanRunId: newScan, severity: 'high' }); // high bucket
    await insertFinding({ scanRunId: newScan, severity: 'medium' }); // medium bucket
    await insertFinding({ scanRunId: newScan, severity: 'low' }); // low bucket
    await insertFinding({ scanRunId: newScan, severity: 'info' }); // low bucket
    await insertFinding({ scanRunId: newScan, severity: 'high', suppressed: true }); // ignored

    // A newer NON-canonical scan whose findings must never be counted.
    const noncanonScan = await insertScan({
      targetAddress: tokenA,
      canonical: false,
      createdAt: '2026-07-17T00:00:00.000Z',
    });
    await insertFinding({ scanRunId: noncanonScan, severity: 'critical' });
    await insertFinding({ scanRunId: noncanonScan, severity: 'critical' });

    const counts = await repository.getFindingSeverityCounts(CHAIN_ID, [tokenA]);

    expect(counts).toHaveLength(1);
    expect(counts[0]).toEqual({
      targetAddress: tokenAddressLower,
      high: 2,
      medium: 1,
      low: 2,
    });
  });

  it('omits tokens whose latest scan has no findings', async () => {
    if (!available) return;
    const repository = new DrizzleRiskRepository(database.db);
    const clean = '0xbBbB000000000000000000000000000000000002';
    await insertScan({
      targetAddress: clean,
      canonical: true,
      createdAt: '2026-07-15T00:00:00.000Z',
    });

    const counts = await repository.getFindingSeverityCounts(CHAIN_ID, [clean]);
    expect(counts).toEqual([]);
  });

  it('returns [] for an empty address list without querying', async () => {
    if (!available) return;
    const repository = new DrizzleRiskRepository(database.db);
    expect(await repository.getFindingSeverityCounts(CHAIN_ID, [])).toEqual([]);
  });
});

// Seed a dex protocol and return its generated id so pools can reference it.
async function insertProtocol(): Promise<number> {
  const rows = await database.client<{ id: number }[]>`
    INSERT INTO dex_protocols
      (chain_id, protocol_key, protocol_name, version, verification_source, verification_date)
    VALUES
      (${CHAIN_ID}, 'test-dex', 'Test DEX', 'v2', 'https://example.test', NOW())
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('protocol insert returned no id');
  return id;
}

async function insertPool(opts: {
  protocolId: number;
  address: string;
  token0: string;
  token1: string;
}): Promise<void> {
  await database.client`
    INSERT INTO pools
      (chain_id, address, protocol_id, protocol_key, protocol_version, factory_address,
       pool_type, token0_address, token1_address, fee_tier, created_block,
       created_block_hash, creation_log_index, created_tx_hash)
    VALUES
      (${CHAIN_ID}, ${opts.address}, ${opts.protocolId}, 'test-dex', 'v2',
       ${`0x${'f'.repeat(40)}`}, 'uniswap_v2', ${opts.token0}, ${opts.token1},
       3000, 1, ${`0x${'b'.repeat(64)}`}, 0, ${`0x${'c'.repeat(64)}`})
  `;
}

async function insertSnapshot(opts: {
  poolAddress: string;
  block: number;
  reserve0?: string | null;
  reserve1?: string | null;
  canonical?: boolean;
}): Promise<void> {
  await database.client`
    INSERT INTO pool_state_snapshots
      (chain_id, pool_address, protocol_key, protocol_version, pool_type,
       source_block_number, source_block_hash, reserve0_raw, reserve1_raw, state, canonical)
    VALUES
      (${CHAIN_ID}, ${opts.poolAddress}, 'test-dex', 'v2', 'uniswap_v2',
       ${opts.block}, ${`0x${opts.block.toString(16).padStart(64, '0')}`},
       ${opts.reserve0 ?? null}, ${opts.reserve1 ?? null}, '{}'::jsonb,
       ${opts.canonical ?? true})
  `;
}

describe('ProtocolRepository.getTokenLiquiditySeries', () => {
  it('returns the most-observed pool series oldest→newest, sliced to points', async () => {
    if (!available) return;
    const repository = new DrizzleProtocolRepositoryImpl(database.db);
    const protocolId = await insertProtocol();
    const tokenX = '0xEeEe000000000000000000000000000000000010';
    const tokenXLower = tokenX.toLowerCase();
    const other = '0x000000000000000000000000000000000000dead';

    // Deep pool where tokenX is token0: three canonical snapshots.
    const deepPool = '0x1111111111111111111111111111111111111111';
    await insertPool({ protocolId, address: deepPool, token0: tokenX, token1: other });
    await insertSnapshot({ poolAddress: deepPool, block: 10, reserve0: '1000' });
    await insertSnapshot({ poolAddress: deepPool, block: 20, reserve0: '2000' });
    await insertSnapshot({ poolAddress: deepPool, block: 30, reserve0: '1500' });
    // A non-canonical snapshot that must be excluded even though it is newest.
    await insertSnapshot({
      poolAddress: deepPool,
      block: 40,
      reserve0: '99999',
      canonical: false,
    });

    // Shallow pool where tokenX is token1: only two snapshots, fewer than deepPool.
    const shallowPool = '0x2222222222222222222222222222222222222222';
    await insertPool({ protocolId, address: shallowPool, token0: other, token1: tokenX });
    await insertSnapshot({ poolAddress: shallowPool, block: 10, reserve1: '500' });
    await insertSnapshot({ poolAddress: shallowPool, block: 20, reserve1: '600' });

    const series = await repository.getTokenLiquiditySeries(CHAIN_ID, [tokenX], 12);

    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({
      tokenAddress: tokenXLower,
      points: [1000, 2000, 1500],
    });
  });

  it('slices to the most recent points', async () => {
    if (!available) return;
    const repository = new DrizzleProtocolRepositoryImpl(database.db);
    const protocolId = await insertProtocol();
    const tokenX = '0xEeEe000000000000000000000000000000000011';
    const other = '0x000000000000000000000000000000000000dead';
    const pool = '0x3333333333333333333333333333333333333333';
    await insertPool({ protocolId, address: pool, token0: tokenX, token1: other });
    await insertSnapshot({ poolAddress: pool, block: 10, reserve0: '100' });
    await insertSnapshot({ poolAddress: pool, block: 20, reserve0: '200' });
    await insertSnapshot({ poolAddress: pool, block: 30, reserve0: '300' });
    await insertSnapshot({ poolAddress: pool, block: 40, reserve0: '400' });

    const series = await repository.getTokenLiquiditySeries(CHAIN_ID, [tokenX], 3);
    expect(series[0]?.points).toEqual([200, 300, 400]);
  });

  it('omits tokens with fewer than two snapshots', async () => {
    if (!available) return;
    const repository = new DrizzleProtocolRepositoryImpl(database.db);
    const protocolId = await insertProtocol();
    const tokenY = '0xEeEe000000000000000000000000000000000012';
    const other = '0x000000000000000000000000000000000000dead';
    const pool = '0x4444444444444444444444444444444444444444';
    await insertPool({ protocolId, address: pool, token0: tokenY, token1: other });
    await insertSnapshot({ poolAddress: pool, block: 10, reserve0: '100' });

    const series = await repository.getTokenLiquiditySeries(CHAIN_ID, [tokenY], 12);
    expect(series).toEqual([]);
  });

  it('returns [] for an empty address list', async () => {
    if (!available) return;
    const repository = new DrizzleProtocolRepositoryImpl(database.db);
    expect(await repository.getTokenLiquiditySeries(CHAIN_ID, [], 12)).toEqual([]);
  });
});
