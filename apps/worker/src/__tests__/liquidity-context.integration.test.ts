import { type Database, DrizzleProtocolRepositoryImpl, createDatabase } from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import { getAddress, padHex, toHex } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DrizzleLiquidityContextSource,
  type LiquidityPoolStateReader,
  LiquidityProjectionPendingError,
} from '../jobs/liquidity-context.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';
const CHAIN_ID = 4663;
const BLOCK = 100n;
const BLOCK_HASH = hash('a');
const PARENT_HASH = hash('b');
const POOL = getAddress('0x1000000000000000000000000000000000000001');
const SECOND_POOL = getAddress('0x1000000000000000000000000000000000000003');
const FACTORY = getAddress('0x1000000000000000000000000000000000000002');
const TOKEN0 = getAddress('0x2000000000000000000000000000000000000001');
const TOKEN1 = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73');
const USDG = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
const CREATOR = getAddress('0x3000000000000000000000000000000000000001');
const LOCKER = getAddress('0x3000000000000000000000000000000000000002');
const BENEFICIARY = getAddress('0x3000000000000000000000000000000000000003');
const DEAD = getAddress('0x000000000000000000000000000000000000dEaD');
const ZERO = getAddress('0x0000000000000000000000000000000000000000');
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const METHODOLOGY = 'risk-partial-1.2.0';

function hash(seed: string): `0x${string}` {
  return `0x${seed.repeat(64).slice(0, 64)}`;
}

class FixturePoolStateReader implements LiquidityPoolStateReader {
  constructor(
    private readonly states: ReadonlyMap<
      string,
      {
        poolType: 'constantProduct';
        reserve0Raw: bigint;
        reserve1Raw: bigint;
        lpTotalSupplyRaw: bigint;
      }
    >,
  ) {}

  async readPoolState(pool: { poolAddress: string }) {
    return this.states.get(pool.poolAddress.toLowerCase()) ?? null;
  }
}

function defaultPoolState() {
  return {
    poolType: 'constantProduct' as const,
    reserve0Raw: 5_000n,
    reserve1Raw: 10_000n,
    lpTotalSupplyRaw: 1_000n,
  };
}

let database: Database;
let source: DrizzleLiquidityContextSource;
let repository: DrizzleProtocolRepositoryImpl;
let available = false;
let poolStates: Map<string, ReturnType<typeof defaultPoolState>>;

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping liquidity context tests');
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
  await seedPool();
  poolStates = new Map([[POOL.toLowerCase(), defaultPoolState()]]);
  repository = new DrizzleProtocolRepositoryImpl(database.db);
  source = new DrizzleLiquidityContextSource(
    database,
    new FixturePoolStateReader(poolStates),
    repository,
    () => new Date('2026-07-15T12:00:00.000Z'),
  );
});

async function seedPool(): Promise<void> {
  await database.client`
    INSERT INTO chains (chain_id, name, native_symbol, enabled)
    VALUES (${CHAIN_ID}, 'Robinhood Chain Test', 'ETH', true)
  `;
  await database.client`
    INSERT INTO blocks (
      chain_id, number, hash, parent_hash, timestamp, finality_state, canonical
    ) VALUES (
      ${CHAIN_ID}, ${BLOCK.toString()}, ${BLOCK_HASH}, ${PARENT_HASH},
      '2026-07-15T10:00:00.000Z', 'finalized', true
    )
  `;
  const protocols = await database.client`
    INSERT INTO dex_protocols (
      chain_id, protocol_key, protocol_name, version, kind, factory_address,
      verification_source, verification_date, registry_version, enabled,
      validation_status, validated_at, validation_expires_at
    ) VALUES (
      ${CHAIN_ID}, 'fixture-dex', 'Fixture DEX', 'v1', 'dex', ${FACTORY.toLowerCase()},
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
      ${CHAIN_ID}, ${POOL.toLowerCase()}, ${protocolId}, 'fixture-dex', 'v1',
      ${FACTORY.toLowerCase()}, ${TOKEN0.toLowerCase()}, ${TOKEN1.toLowerCase()},
      3000, 'constantProduct', 90, ${hash('c')}, ${hash('d')}, 0, true, true
    )
  `;
  await database.client`
    INSERT INTO pool_tokens (chain_id, pool_address, token_address, reserve_raw)
    VALUES
      (${CHAIN_ID}, ${POOL.toLowerCase()}, ${TOKEN0.toLowerCase()}, 0),
      (${CHAIN_ID}, ${POOL.toLowerCase()}, ${TOKEN1.toLowerCase()}, 0)
  `;
  await database.client`
    INSERT INTO contracts (
      chain_id, address, creator_address, creation_tx_hash, creation_block
    ) VALUES (
      ${CHAIN_ID}, ${TOKEN0.toLowerCase()}, ${CREATOR.toLowerCase()}, ${hash('f')}, 80
    )
  `;
}

async function seedSecondPool(): Promise<void> {
  const protocols = await database.client`
    SELECT id FROM dex_protocols
    WHERE chain_id = ${CHAIN_ID} AND protocol_key = 'fixture-dex' AND version = 'v1'
  `;
  const protocolId = protocols[0]?.id;
  if (protocolId === undefined) throw new Error('Fixture protocol lookup failed');
  await database.client`
    INSERT INTO pools (
      chain_id, address, protocol_id, protocol_key, protocol_version, factory_address,
      token0_address, token1_address, fee_tier, pool_type, created_block,
      created_block_hash, created_tx_hash, creation_log_index, canonical, active
    ) VALUES (
      ${CHAIN_ID}, ${SECOND_POOL.toLowerCase()}, ${protocolId}, 'fixture-dex', 'v1',
      ${FACTORY.toLowerCase()}, ${TOKEN0.toLowerCase()}, ${USDG.toLowerCase()},
      3000, 'constantProduct', 91, ${hash('7')}, ${hash('8')}, 0, true, true
    )
  `;
  await database.client`
    INSERT INTO pool_tokens (chain_id, pool_address, token_address, reserve_raw)
    VALUES
      (${CHAIN_ID}, ${SECOND_POOL.toLowerCase()}, ${TOKEN0.toLowerCase()}, 0),
      (${CHAIN_ID}, ${SECOND_POOL.toLowerCase()}, ${USDG.toLowerCase()}, 0)
  `;
}

async function seedWethUsdgPrice(): Promise<void> {
  await database.client`
    INSERT INTO price_source_configs (
      source_key, source_type, asset_class, chain_id, source_asset_address,
      quote_asset_address, verification_source_url, verified_at,
      minimum_liquidity_raw, liquidity_decimals, maximum_staleness_seconds,
      enabled, priority, confidence_rules, route, methodology_version
    ) VALUES (
      'weth-usdg-fixture', 'directDex', 'wrappedEth', ${CHAIN_ID}, ${TOKEN1.toLowerCase()},
      ${USDG.toLowerCase()}, 'https://pricing.example/verified',
      '2026-07-15T00:00:00.000Z', 1, 18, 3600, true, 1,
      '{}'::jsonb, '[]'::jsonb, 'pricing-v1'
    )
  `;
  await database.client`
    INSERT INTO deterministic_price_observations (
      observation_key, chain_id, token_address, quote_asset_address, source_key,
      source_type, route, price_raw, price_decimals, source_block_number,
      source_block_hash, source_timestamp, observed_at, confidence_bps, stale,
      status, authoritative, reasons, canonical, methodology_version
    ) VALUES (
      'weth-usdg-at-100', ${CHAIN_ID}, ${TOKEN1.toLowerCase()}, ${USDG.toLowerCase()},
      'weth-usdg-fixture', 'directDex', '[]'::jsonb, ${(2n * 10n ** 18n).toString()}, 18,
      ${BLOCK.toString()}, ${BLOCK_HASH}, '2026-07-15T10:00:00.000Z',
      '2026-07-15T10:00:00.000Z', 9500, false, 'available', true, '[]'::jsonb, true,
      'pricing-v1'
    )
  `;
}

async function insertTransfer(input: {
  pool?: string;
  from: string;
  to: string;
  amountRaw: bigint;
  logIndex: number;
  indexed?: boolean;
}): Promise<void> {
  const pool = getAddress(input.pool ?? POOL);
  const transactionHash = hash((input.logIndex + 1).toString(16));
  const data = toHex(input.amountRaw, { size: 32 });
  await database.client`
    INSERT INTO transactions (
      chain_id, hash, block_number, block_hash, from_address, to_address,
      nonce, value_raw, input, status, gas_used, effective_gas_price, canonical
    ) VALUES (
      ${CHAIN_ID}, ${transactionHash}, ${BLOCK.toString()}, ${BLOCK_HASH},
      ${input.from.toLowerCase()}, ${pool.toLowerCase()}, ${input.logIndex}, 0, '0x', 1, 1, 1, true
    ) ON CONFLICT DO NOTHING
  `;
  await database.client`
    INSERT INTO logs (
      chain_id, transaction_hash, log_index, block_hash, block_number, address,
      topic0, topic1, topic2, data, removed, canonical
    ) VALUES (
      ${CHAIN_ID}, ${transactionHash}, ${input.logIndex}, ${BLOCK_HASH}, ${BLOCK.toString()},
      ${pool}, ${TRANSFER_TOPIC}, ${padHex(getAddress(input.from))},
      ${padHex(getAddress(input.to))}, ${data}, false, true
    )
  `;
  if (input.indexed === false) return;
  await database.client`
    INSERT INTO token_transfers (
      chain_id, block_number, block_hash, transaction_hash, log_index,
      token_address, from_address, to_address, amount_raw, canonical
    ) VALUES (
      ${CHAIN_ID}, ${BLOCK.toString()}, ${BLOCK_HASH}, ${transactionHash}, ${input.logIndex},
      ${pool.toLowerCase()}, ${input.from.toLowerCase()}, ${input.to.toLowerCase()},
      ${input.amountRaw.toString()}, true
    )
  `;
}

function loadPool() {
  return source.load({
    target: { type: 'pool', chainId: CHAIN_ID, address: POOL },
    sourceBlock: BLOCK,
    sourceBlockHash: BLOCK_HASH,
    methodologyVersion: METHODOLOGY,
  });
}

function loadToken() {
  return source.load({
    target: { type: 'token', chainId: CHAIN_ID, address: TOKEN0 },
    sourceBlock: BLOCK,
    sourceBlockHash: BLOCK_HASH,
    methodologyVersion: METHODOLOGY,
  });
}

describe('live liquidity context', () => {
  it('persists pinned reserves and reports creator and burned LP ownership', async () => {
    await insertTransfer({ from: ZERO, to: CREATOR, amountRaw: 600n, logIndex: 1 });
    await insertTransfer({ from: ZERO, to: DEAD, amountRaw: 400n, logIndex: 2 });

    const result = await loadPool();

    expect(result.status).toBe('available');
    expect(result.input?.ownership).toMatchObject({ kind: 'creator', owner: CREATOR });
    expect(result.input?.burnedLiquidityRaw).toBe(400n);
    expect(result.input?.burnedProviders).toEqual([{ address: DEAD, liquidityRaw: 400n }]);
    expect(result.input?.providers).toEqual([{ address: CREATOR, liquidityRaw: 600n }]);

    const snapshots = await database.client`
      SELECT source_block_hash, reserve0_raw, reserve1_raw, lp_total_supply_raw, canonical
      FROM pool_state_snapshots
      WHERE chain_id = ${CHAIN_ID} AND pool_address = ${POOL.toLowerCase()}
    `;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      source_block_hash: BLOCK_HASH,
      reserve0_raw: '5000',
      reserve1_raw: '10000',
      lp_total_supply_raw: '1000',
      canonical: true,
    });
    const reserves = await database.client`
      SELECT token_address, reserve_raw FROM pool_tokens
      WHERE chain_id = ${CHAIN_ID} AND pool_address = ${POOL.toLowerCase()}
      ORDER BY token_address
    `;
    expect(reserves.map((row) => row.reserve_raw)).toEqual(['10000', '5000']);

    await repository.markDerivedNonCanonical(CHAIN_ID, BLOCK, BLOCK);
    const orphaned = await database.client`
      SELECT canonical FROM pool_state_snapshots
      WHERE chain_id = ${CHAIN_ID} AND pool_address = ${POOL.toLowerCase()}
    `;
    expect(orphaned[0]?.canonical).toBe(false);
    const current = await database.client`
      SELECT state, state_block_number, state_block_hash FROM pools
      WHERE chain_id = ${CHAIN_ID} AND address = ${POOL.toLowerCase()}
    `;
    expect(current[0]).toMatchObject({
      state: null,
      state_block_number: null,
      state_block_hash: null,
    });
  });

  it('accepts lock evidence only when the lock covers the unburned LP supply', async () => {
    await insertTransfer({ from: ZERO, to: LOCKER, amountRaw: 1_000n, logIndex: 3 });
    await database.client`
      INSERT INTO liquidity_lock_evidence (
        chain_id, pool_address, lock_contract_address, beneficiary_address,
        locked_amount_raw, unlock_time, withdrawal_conditions, verification_source,
        verified_at, verification_expires_at, source_block_number, source_block_hash,
        transaction_hash, log_index, methodology_version, canonical
      ) VALUES (
        ${CHAIN_ID}, ${POOL.toLowerCase()}, ${LOCKER.toLowerCase()}, ${BENEFICIARY.toLowerCase()},
        1000, '2027-07-15T00:00:00.000Z', 'Beneficiary withdraws after unlock time',
        'https://locker.example/verification', '2026-07-15T00:00:00.000Z',
        '2026-07-16T00:00:00.000Z', ${BLOCK.toString()}, ${BLOCK_HASH}, ${hash('e')}, 4,
        ${METHODOLOGY}, true
      )
    `;

    const result = await loadPool();

    expect(result.input?.ownership).toMatchObject({
      kind: 'locked',
      owner: LOCKER,
      lockContract: LOCKER,
      beneficiary: BENEFICIARY,
      verified: true,
    });
    expect(result.input?.ownership.evidence).toMatchObject({
      sourceBlock: BLOCK,
      sourceBlockHash: BLOCK_HASH,
      transactionHash: hash('e'),
      logIndex: 4,
      methodologyVersion: METHODOLOGY,
    });
  });

  it('retries while a raw LP transfer has not reached the derived projection', async () => {
    await insertTransfer({
      from: ZERO,
      to: CREATOR,
      amountRaw: 1_000n,
      logIndex: 5,
      indexed: false,
    });

    await expect(loadPool()).rejects.toBeInstanceOf(LiquidityProjectionPendingError);
  });

  it('normalizes WETH and USDG pools and selects the best standard-size quote', async () => {
    const e18 = 10n ** 18n;
    await seedSecondPool();
    await seedWethUsdgPrice();
    poolStates.set(POOL.toLowerCase(), {
      poolType: 'constantProduct',
      reserve0Raw: 5_000n * e18,
      reserve1Raw: 10_000n * e18,
      lpTotalSupplyRaw: 1_000n * e18,
    });
    poolStates.set(SECOND_POOL.toLowerCase(), {
      poolType: 'constantProduct',
      reserve0Raw: 20_000n * e18,
      reserve1Raw: 20_000n * e18,
      lpTotalSupplyRaw: 2_000n * e18,
    });
    await insertTransfer({
      pool: POOL,
      from: ZERO,
      to: DEAD,
      amountRaw: 1_000n * e18,
      logIndex: 10,
    });
    await insertTransfer({
      pool: SECOND_POOL,
      from: ZERO,
      to: DEAD,
      amountRaw: 2_000n * e18,
      logIndex: 11,
    });

    const result = await loadToken();

    expect(result.status).toBe('available');
    expect(result.input?.quoteAsset).toBe(USDG);
    expect(result.input?.poolCount).toBe(2);
    expect(result.input?.normalizedQuoteLiquidityRaw).toBe(40_000n * e18);
    expect(result.input?.poolConcentrationBps).toBe(5_000n);
    expect(result.input?.ownership).toEqual({ kind: 'burned', verified: true });
    expect(result.input?.standardTradeImpacts).toHaveLength(3);
    expect(result.input?.standardTradeImpacts?.[1]).toMatchObject({
      amountQuoteRaw: 1_000n * e18,
      poolAddress: SECOND_POOL,
      priceImpactBps: 504n,
    });
    expect(result.input?.priceImpactBps).toBe(504n);
    expect(result.input?.pools?.map((pool) => pool.normalization.kind).sort()).toEqual([
      'identity',
      'price_observation',
    ]);
    const observationPool = result.input?.pools?.find(
      (pool) => pool.normalization.kind === 'price_observation',
    );
    expect(observationPool?.normalization).toMatchObject({
      sourceKey: 'weth-usdg-fixture',
      sourceBlock: BLOCK,
      sourceBlockHash: BLOCK_HASH,
      maximumStalenessSeconds: 3_600,
      verificationSourceUrl: 'https://pricing.example/verified',
    });

    const snapshots = await database.client`
      SELECT pool_address, source_block_hash, canonical
      FROM pool_state_snapshots
      WHERE chain_id = ${CHAIN_ID}
      ORDER BY pool_address
    `;
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((row) => row.source_block_hash === BLOCK_HASH)).toBe(true);
  });

  it('withholds a multi-pool result when one quote asset lacks pinned normalization', async () => {
    const e18 = 10n ** 18n;
    await seedSecondPool();
    poolStates.set(POOL.toLowerCase(), {
      poolType: 'constantProduct',
      reserve0Raw: 5_000n * e18,
      reserve1Raw: 10_000n * e18,
      lpTotalSupplyRaw: 1_000n * e18,
    });
    poolStates.set(SECOND_POOL.toLowerCase(), {
      poolType: 'constantProduct',
      reserve0Raw: 20_000n * e18,
      reserve1Raw: 20_000n * e18,
      lpTotalSupplyRaw: 2_000n * e18,
    });
    await insertTransfer({
      pool: POOL,
      from: ZERO,
      to: DEAD,
      amountRaw: 1_000n * e18,
      logIndex: 12,
    });
    await insertTransfer({
      pool: SECOND_POOL,
      from: ZERO,
      to: DEAD,
      amountRaw: 2_000n * e18,
      logIndex: 13,
    });

    const result = await loadToken();

    expect(result).toMatchObject({
      status: 'unavailable',
      reason: 'LIQUIDITY_QUOTE_NORMALIZATION_UNAVAILABLE',
      input: null,
    });
  });
});
