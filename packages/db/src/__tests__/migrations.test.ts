import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';

describe('Database Migrations', () => {
  let sql: ReturnType<typeof postgres>;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      sql = postgres(TEST_DATABASE_URL, { connect_timeout: 2 });
      await sql`SELECT 1`;
      dbAvailable = true;

      // Clean up test database
      await sql`DROP SCHEMA public CASCADE`;
      await sql`CREATE SCHEMA public`;
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.warn('Database not available, skipping tests:', (error as Error).message);
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      await sql.end();
    }
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

  it('should apply all migrations successfully', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.join(__dirname, '..', '..', 'migrations');

    // Create migrations table
    await sql`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf-8');

      await sql.begin(async (tx) => {
        await tx.unsafe(sqlContent);
        await tx`INSERT INTO migrations (name) VALUES (${file})`;
      });
    }

    const applied = await sql`SELECT name FROM migrations ORDER BY id`;
    expect(applied.length).toBe(files.length);
  });

  it('should handle bigint round-trip correctly', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    const testValue = '99999999999999999999999999999999999999';

    await sql`INSERT INTO chains (chain_id, name, native_symbol) VALUES (1, 'Test', 'TEST')`;

    await sql`
      INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
      VALUES (1, ${testValue}, '0x123', '0x000', NOW(), 'confirmed', true)
    `;

    const result = await sql`SELECT number FROM blocks WHERE chain_id = 1`;
    expect(result[0]?.number).toBe(testValue);
  });

  it('should enforce foreign key constraints', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    await expect(
      sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
          VALUES (999, 1, '0x456', '0x000', NOW(), 'confirmed', true)`,
    ).rejects.toThrow();
  });

  it('should handle transaction rollback on error', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

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

  it('should support cursor-based pagination', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    // Insert test data
    for (let i = 0; i < 10; i++) {
      await sql`
        INSERT INTO token_transfers (chain_id, block_number, block_hash, transaction_hash, log_index, token_address, from_address, to_address, amount_raw)
        VALUES (1, ${i}, '0xhash', '0xtx${i}', 0, '0xtoken', '0xfrom', '0xto', 1000)
      `;
    }

    // First page
    const page1 = await sql`
      SELECT * FROM token_transfers
      WHERE chain_id = 1
      ORDER BY created_at DESC
      LIMIT 5
    `;
    expect(page1.length).toBe(5);

    // Second page using cursor
    const cursor = page1[page1.length - 1]?.created_at;
    const page2 = await sql`
      SELECT * FROM token_transfers
      WHERE chain_id = 1 AND created_at < ${cursor}
      ORDER BY created_at DESC
      LIMIT 5
    `;
    expect(page2.length).toBe(5);
    expect(page2[0]?.created_at < cursor).toBe(true);
  });
});
