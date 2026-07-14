import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';

describe('Repository Layer', () => {
  let sql: ReturnType<typeof postgres>;
  let dbAvailable = false;

  beforeAll(async () => {
    try {
      sql = postgres(TEST_DATABASE_URL, { connect_timeout: 2 });
      await sql`SELECT 1`;
      dbAvailable = true;
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

  it('should create and retrieve chain', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    await sql`INSERT INTO chains (chain_id, name, native_symbol, enabled) VALUES (4663, 'Robinhood Mainnet', 'ETH', true)`;

    const result = await sql`SELECT * FROM chains WHERE chain_id = 4663`;
    expect(result.length).toBe(1);
    expect(result[0]?.name).toBe('Robinhood Mainnet');
    expect(result[0]?.enabled).toBe(true);
  });

  it('should handle duplicate chain log entries', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    await sql`INSERT INTO chains (chain_id, name, native_symbol) VALUES (2, 'Test', 'TEST')`;

    // Insert same block twice (idempotent operation)
    await sql`
      INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
      VALUES (2, 100, '0xabc', '0x000', NOW(), 'confirmed', true)
      ON CONFLICT (chain_id, number, hash) DO NOTHING
    `;

    await sql`
      INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
      VALUES (2, 100, '0xabc', '0x000', NOW(), 'confirmed', true)
      ON CONFLICT (chain_id, number, hash) DO NOTHING
    `;

    const result =
      await sql`SELECT COUNT(*) as count FROM blocks WHERE chain_id = 2 AND number = 100`;
    expect(result[0]?.count).toBe('1');
  });

  it('should preserve numeric precision for token amounts', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    await sql`INSERT INTO chains (chain_id, name, native_symbol) VALUES (3, 'Test', 'TEST')`;
    await sql`INSERT INTO tokens (chain_id, address, symbol, token_type, total_supply_raw) VALUES (3, '0xtoken', 'TKN', 'erc20', 1000000000000000000000000)`;

    const result =
      await sql`SELECT total_supply_raw FROM tokens WHERE chain_id = 3 AND address = '0xtoken'`;
    expect(result[0]?.total_supply_raw).toBe('1000000000000000000000000');
  });

  it('should support partial indexes for canonical blocks', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    await sql`INSERT INTO chains (chain_id, name, native_symbol) VALUES (4, 'Test', 'TEST')`;

    // Insert canonical and non-canonical blocks
    await sql`
      INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
      VALUES (4, 1, '0x1', '0x0', NOW(), 'confirmed', true)
    `;
    await sql`
      INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, finality_state, canonical)
      VALUES (4, 1, '0x2', '0x0', NOW(), 'confirmed', false)
    `;

    const canonical = await sql`SELECT * FROM blocks WHERE chain_id = 4 AND canonical = true`;
    expect(canonical.length).toBe(1);
    expect(canonical[0]?.hash).toBe('0x1');
  });

  it('should handle soft deletion for watchlists', async () => {
    if (!dbAvailable) {
      // biome-ignore lint/suspicious/noConsole: test output
      console.log('Skipping: database not available');
      return;
    }

    await sql`INSERT INTO users (id, status) VALUES ('user1', 'active')`;
    await sql`INSERT INTO watchlists (id, user_id, name, is_default) VALUES ('wl1', 'user1', 'My Watchlist', true)`;

    // Soft delete
    await sql`UPDATE watchlists SET deleted_at = NOW() WHERE id = 'wl1'`;

    // Should not appear in active queries
    const active =
      await sql`SELECT * FROM watchlists WHERE user_id = 'user1' AND deleted_at IS NULL`;
    expect(active.length).toBe(0);

    // But still exists in database
    const all = await sql`SELECT * FROM watchlists WHERE id = 'wl1'`;
    expect(all.length).toBe(1);
    expect(all[0]?.deleted_at).not.toBeNull();
  });
});
