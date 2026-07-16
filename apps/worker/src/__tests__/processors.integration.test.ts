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
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const POOL = '0x1111111111111111111111111111111111111111';
const FACTORY = '0x2222222222222222222222222222222222222222';

function hash(seed: string): string {
  return `0x${seed.repeat(64).slice(0, 64)}`;
}

let database: Database;
let route: ReturnType<typeof createDerivedJobRouter>;
let available = false;
let deliveredAlertIds: string[] = [];
let tokenMetadataEnabled = false;

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

beforeEach(async ({ skip }) => {
  skip(!available, 'PostgreSQL is unavailable');
  if (database) await database.close();
  database = createDatabase(TEST_DATABASE_URL);
  await resetAndMigrate(database.client);
  await database.client`
    INSERT INTO chains (chain_id, name, native_symbol, enabled)
    VALUES (${CHAIN_ID}, 'Robinhood Chain Test', 'ETH', true)
  `;
  deliveredAlertIds = [];
  tokenMetadataEnabled = false;
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
      alertDelivery: {
        async deliver(event) {
          deliveredAlertIds.push(event.id);
        },
      },
      riskAlerts: {
        async evaluate() {},
      },
      chainReader: {
        async getBytecode() {
          if (!tokenMetadataEnabled) {
            throw new Error('Token metadata was not expected in this test');
          }
          return '0x6000';
        },
        async readContract(request) {
          if (!tokenMetadataEnabled) {
            throw new Error('Token metadata was not expected in this test');
          }
          if (request.functionName === 'name') return 'Fixture Token';
          if (request.functionName === 'symbol') return 'FIX';
          if (request.functionName === 'decimals') return 18;
          if (request.functionName === 'totalSupply') return 1_000_000n * 10n ** 18n;
          throw new Error(`Unexpected metadata function: ${request.functionName}`);
        },
      },
      protocolEnrichment: {
        async run() {
          throw new Error('Protocol enrichment was not expected in this test');
        },
      },
    },
  );
});

describe('alert-evaluation processor', () => {
  it('creates one traceable alert for a redelivered matching transfer', async () => {
    const userId = '10000000-0000-4000-8000-000000000001';
    const blockHash = hash('7');
    const transactionHash = hash('8');
    await database.client`
      INSERT INTO blocks (
        chain_id, number, hash, parent_hash, timestamp, finality_state, canonical
      ) VALUES (${CHAIN_ID}, 100, ${blockHash}, ${hash('0')}, NOW(), 'finalized', true)
    `;
    await database.client`INSERT INTO users (id, status) VALUES (${userId}, 'active')`;
    await database.client`
      INSERT INTO alert_rules (
        user_id, chain_id, target_address, rule_type, condition, channels, enabled
      ) VALUES (
        ${userId}, ${CHAIN_ID}, ${TOKEN}, 'large_transfer',
        ${JSON.stringify({ minimumAmountRaw: '1000' })}::jsonb,
        ${JSON.stringify(['in_app'])}::jsonb, true
      )
    `;
    const payload = job({
      type: 'alert-evaluation',
      blockHash,
      data: {
        eventType: 'tokenTransfer',
        tokenAddress: TOKEN,
        fromAddress: OWNER,
        toAddress: RECIPIENT,
        valueRaw: '1001',
        transactionHash,
        logIndex: 4,
      },
    });

    await route(payload);
    await route(payload);

    const rows = await database.client`
      SELECT block_hash, transaction_hash, log_index
      FROM alert_events
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      block_hash: blockHash,
      transaction_hash: transactionHash,
      log_index: 4,
    });
    expect(deliveredAlertIds).toHaveLength(2);
    expect(new Set(deliveredAlertIds).size).toBe(1);
  });
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

describe('token-metadata processor', () => {
  it('reads pinned ERC-20 metadata and preserves one canonical token identity', async () => {
    tokenMetadataEnabled = true;
    const payload = job({
      type: 'token-metadata',
      data: { tokenAddress: TOKEN },
    });
    await route(payload);
    await route(payload);

    const rows = await database.client`
      SELECT name, symbol, decimals, total_supply_raw, metadata_status, first_seen_block
      FROM tokens
      WHERE chain_id = ${CHAIN_ID} AND address = ${TOKEN}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Fixture Token',
      symbol: 'FIX',
      decimals: 18,
      total_supply_raw: '1000000000000000000000000',
      metadata_status: 'complete',
      first_seen_block: '100',
    });
  });
});

describe('verified pool market processors', () => {
  it('stores one source observation and eight metric windows on redelivery', async () => {
    const blockHash = hash('4');
    const transactionHash = hash('5');
    await database.client`
      INSERT INTO blocks (
        chain_id, number, hash, parent_hash, timestamp, finality_state, canonical
      ) VALUES (
        ${CHAIN_ID}, 100, ${blockHash}, ${hash('0')},
        '2026-07-15T10:05:00.000Z', 'finalized', true
      )
    `;
    await database.client`
      INSERT INTO tokens (
        chain_id, address, name, symbol, decimals, total_supply_raw, token_type, metadata_status
      ) VALUES
        (${CHAIN_ID}, ${TOKEN}, 'Fixture Token', 'FIX', 18, '1000000000000000000000000', 'erc20', 'complete'),
        (${CHAIN_ID}, ${USDG}, 'USDG', 'USDG', 18, '1000000000000000000000000', 'erc20', 'complete')
    `;
    const protocols = await database.client`
      INSERT INTO dex_protocols (
        chain_id, protocol_key, protocol_name, version, kind, factory_address,
        verification_source, verification_date, registry_version, enabled,
        validation_status, validated_at, validation_expires_at
      ) VALUES (
        ${CHAIN_ID}, 'fixture-dex', 'Fixture DEX', 'v1', 'dex', ${FACTORY},
        'https://protocol.example/deployments', '2026-07-15T00:00:00.000Z', '1.0.0', true,
        'active', '2026-07-15T00:00:00.000Z', '2026-07-16T00:00:00.000Z'
      ) RETURNING id
    `;
    const protocolId = protocols[0]?.id;
    if (protocolId === undefined) throw new Error('Fixture protocol insert failed');
    await database.client`
      INSERT INTO pools (
        chain_id, address, protocol_id, protocol_key, protocol_version, factory_address,
        token0_address, token1_address, fee_tier, pool_type, created_block,
        created_block_hash, created_tx_hash, creation_log_index, canonical, active
      ) VALUES (
        ${CHAIN_ID}, ${POOL}, ${protocolId}, 'fixture-dex', 'v1', ${FACTORY},
        ${TOKEN}, ${USDG}, 3000, 'constantProduct', 90,
        ${hash('1')}, ${hash('2')}, 0, true, true
      )
    `;
    await database.client`
      INSERT INTO pool_state_snapshots (
        chain_id, pool_address, protocol_key, protocol_version, pool_type,
        source_block_number, source_block_hash, reserve0_raw, reserve1_raw,
        state, source_provider, canonical, observed_at
      ) VALUES (
        ${CHAIN_ID}, ${POOL}, 'fixture-dex', 'v1', 'constantProduct',
        100, ${blockHash}, '500000000000000000000000', '1000000000000000000000000',
        ${JSON.stringify({ poolType: 'constantProduct' })}::jsonb, 'rpc', true,
        '2026-07-15T10:05:00.000Z'
      )
    `;
    await database.client`
      INSERT INTO swaps (
        chain_id, protocol_key, protocol_version, block_number, block_hash,
        transaction_hash, log_index, pool_address, sender_address, recipient_address,
        token_in_address, token_out_address, amount_in_raw, amount_out_raw, canonical
      ) VALUES (
        ${CHAIN_ID}, 'fixture-dex', 'v1', 100, ${blockHash}, ${transactionHash}, 3,
        ${POOL}, ${OWNER}, ${RECIPIENT}, ${USDG}, ${TOKEN},
        '100000000000000000000', '49000000000000000000', true
      )
    `;
    const data = {
      protocolKey: 'fixture-dex',
      protocolVersion: 'v1',
      poolAddress: POOL,
      transactionHash,
      logIndex: 3,
      eventType: 'swap',
    };
    const priceJob = job({ type: 'new-price-observation', blockHash, data });
    const metricJob = job({ type: 'market-metric', blockHash, data });
    const walletJob = job({ type: 'wallet-activity', blockHash, data });

    await route(priceJob);
    await route(priceJob);
    await route(metricJob);
    await route(metricJob);
    await route(walletJob);
    await route(walletJob);

    const configs = await database.client`SELECT * FROM price_source_configs`;
    const observations = await database.client`SELECT * FROM deterministic_price_observations`;
    const metrics = await database.client`SELECT * FROM market_metrics`;
    const candles = await database.client`SELECT * FROM market_candles`;
    const pnl = await database.client`
      SELECT * FROM wallet_pnl_snapshots WHERE wallet_address = ${RECIPIENT}
    `;
    const lots = await database.client`
      SELECT * FROM wallet_token_lots WHERE wallet_address = ${RECIPIENT}
    `;
    const cashFlows = await database.client`
      SELECT * FROM wallet_cash_flows WHERE wallet_address = ${RECIPIENT}
    `;
    expect(configs).toHaveLength(1);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.price_raw).toBe('2000000000000000000');
    expect(metrics).toHaveLength(8);
    expect(candles).toHaveLength(8);
    expect(pnl).toHaveLength(1);
    expect(pnl[0]).toMatchObject({
      balance_raw: '49000000000000000000',
      cost_basis_raw: '100000000000000000000',
      realized_pnl_raw: '0',
      unrealized_pnl_raw: '-2000000000000000000',
      quote_asset_address: USDG,
      confidence: '1.00',
      incomplete_history: false,
      canonical: true,
    });
    expect(lots).toHaveLength(1);
    expect(cashFlows).toHaveLength(1);
  });
});

describe('router', () => {
  it('dead-letters an unrecognised type rather than dropping it', async () => {
    if (!available) return;
    await expect(route(job({ type: 'not-a-real-type' }))).rejects.toThrow(/Unrecognised/);
  });
});
