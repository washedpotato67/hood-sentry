import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, resetSchema } from './setup.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';
const sql = postgres(TEST_DATABASE_URL, { connect_timeout: 2 });

describe('Database Migrations', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      await sql`SELECT 1`;

      // Start from a clean schema; the "apply all migrations" test builds it up.
      await resetSchema(sql);
      dbAvailable = true;
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.warn(
        'Database not available, skipping tests:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
  });

  afterAll(async () => {
    await sql.end();
  });

  it('defines external protocol tables and blocks unsafe legacy conversion', () => {
    const migration = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'migrations',
        '010_external_protocol_adapters.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('requires an explicit market-data backfill');
    expect(migration).toContain('CREATE TABLE protocol_contract_verifications');
    expect(migration).toContain('CREATE TABLE launchpad_creator_fee_events');
    expect(migration).toContain('CREATE TABLE launchpad_migrations');
    expect(migration).toContain('ALTER TABLE pool_tokens RENAME COLUMN pool_chain_id TO chain_id');
    expect(migration).toContain('protocol_id BIGINT NOT NULL REFERENCES dex_protocols(id)');
  });

  it('defines deterministic price provenance and versioned market aggregates', () => {
    const migration = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'migrations',
        '011_deterministic_pricing.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS price_source_configs');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS deterministic_price_observations');
    expect(migration).toContain('source_block_hash TEXT');
    expect(migration).toContain('methodology_version TEXT NOT NULL');
    expect(migration).toContain('market_capitalization_raw NUMERIC(78,0)');
    expect(migration).toContain('fully_diluted_valuation_raw NUMERIC(78,0)');
  });

  it('defines versioned discovery snapshots and separate sponsorship audit history', () => {
    const migration = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'migrations',
        '012_discovery_rankings.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS discovery_snapshots');
    expect(migration).toContain('methodology_version TEXT NOT NULL');
    expect(migration).toContain('score_bps NUMERIC(78,0) NOT NULL');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS sponsored_placements');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS sponsored_placement_audit');
  });

  it('defines deterministic risk history, rescan triggers, and reorg state', () => {
    const migration = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'migrations',
        '013_deterministic_risk_engine.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('source_block_hash TEXT');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS risk_ruleset_versions');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS risk_rescan_requests');
    expect(migration).toContain('idempotency_key TEXT NOT NULL UNIQUE');
    expect(migration).toContain("'methodology_version_change'");
    expect(migration).toContain('canonical BOOLEAN NOT NULL DEFAULT true');
  });

  it('defines block-pinned liquidity state and verified lock evidence', () => {
    const migration = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'migrations',
        '017_liquidity_risk_context.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS pool_state_snapshots');
    expect(migration).toContain('source_block_hash TEXT NOT NULL');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS liquidity_lock_evidence');
    expect(migration).toContain('withdrawal_conditions TEXT NOT NULL');
    expect(migration).toContain('token_transfers_chain_log_idx');
  });

  it('should apply all migrations successfully', async ({ skip }) => {
    skip(!dbAvailable, 'PostgreSQL is unavailable');
    const files = await applyMigrations(sql);
    expect(files.length).toBeGreaterThan(0);

    const applied = await sql`SELECT name FROM migrations ORDER BY id`;
    expect(applied.length).toBe(files.length);
  });

  it('should handle bigint round-trip correctly', async ({ skip }) => {
    skip(!dbAvailable, 'PostgreSQL is unavailable');
    const testValue = '9223372036854775807';

    await sql`INSERT INTO chains (chain_id, name, native_symbol) VALUES (1, 'Test', 'TEST')`;

    await sql`
      INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
      VALUES (1, ${testValue}, '0x123', '0x000', NOW(), 'soft_confirmed', true)
    `;

    const result = await sql`SELECT number FROM blocks WHERE chain_id = 1`;
    expect(result[0]?.number).toBe(testValue);
  });

  it('should enforce foreign key constraints', async ({ skip }) => {
    skip(!dbAvailable, 'PostgreSQL is unavailable');
    await expect(
      sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
          VALUES (999, 1, '0x456', '0x000', NOW(), 'soft_confirmed', true)`,
    ).rejects.toThrow();
  });

  it('should handle transaction rollback on error', async ({ skip }) => {
    skip(!dbAvailable, 'PostgreSQL is unavailable');
    const initialCount = await sql`SELECT COUNT(*) as count FROM tokens WHERE chain_id = 1`;

    await expect(
      sql.begin(async (tx) => {
        await tx`INSERT INTO tokens (chain_id, address, symbol, token_type) VALUES (1, '0xabc', 'TKN', 'erc20')`;
        throw new Error('Intentional error');
      }),
    ).rejects.toThrow('Intentional error');

    const finalCount = await sql`SELECT COUNT(*) as count FROM tokens WHERE chain_id = 1`;
    expect(finalCount[0]?.count).toBe(initialCount[0]?.count);
  });

  it('should support cursor-based pagination', async ({ skip }) => {
    skip(!dbAvailable, 'PostgreSQL is unavailable');
    // Insert test data
    for (let i = 0; i < 10; i++) {
      const transactionHash = `0xtx${i}`;
      await sql`
        INSERT INTO token_transfers (chain_id, block_number, block_hash, transaction_hash, log_index, token_address, from_address, to_address, amount_raw)
        VALUES (1, ${i}, '0xhash', ${transactionHash}, 0, '0xtoken', '0xfrom', '0xto', 1000)
      `;
    }

    // First page (paginate on block_number, a stable unique cursor)
    const page1 = await sql`
      SELECT * FROM token_transfers
      WHERE chain_id = 1
      ORDER BY block_number DESC
      LIMIT 5
    `;
    expect(page1.length).toBe(5);

    // Second page using cursor
    const cursor = page1[page1.length - 1]?.block_number;
    const page2 = await sql`
      SELECT * FROM token_transfers
      WHERE chain_id = 1 AND block_number < ${cursor}
      ORDER BY block_number DESC
      LIMIT 5
    `;
    expect(page2.length).toBe(5);
    expect(Number(page2[0]?.block_number) < Number(cursor)).toBe(true);
  });
});
