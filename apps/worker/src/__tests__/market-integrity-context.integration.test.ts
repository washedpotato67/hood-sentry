import { type Database, createDatabase } from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import { getAddress } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleMarketDataSource } from '../jobs/market-integrity-context.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';
const CHAIN_ID = 4665;
const BLOCK = 100n;
const BLOCK_HASH = hash('a');
const PARENT_HASH = hash('b');
const TOKEN = getAddress('0x2000000000000000000000000000000000000021');
const QUOTE = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
const POOL = getAddress('0x1000000000000000000000000000000000000099');
// Real DEX swaps routed through a router contract have distinct sender (the
// router) and recipient (the trading wallet) addresses. Self-trading is the
// degenerate case where both are the same address.
const ROUTER = getAddress('0x4000000000000000000000000000000000000001');
const WALLET_A = getAddress('0x3000000000000000000000000000000000000011');
const WALLET_B = getAddress('0x3000000000000000000000000000000000000012');

const PERMISSIVE_CONFIDENCE_RULES = {
  baseConfidenceBps: '9500',
  thinLiquidityPenaltyBps: '0',
  stalePenaltyBps: '0',
  disagreementThresholdBps: '500',
  disagreementPenaltyBps: '1000',
  maximumPriceImpactBps: '10000',
  maximumSingleTransactionVolumeBps: '10000',
  maximumPriceJumpBps: '10000',
  stablecoinDepegThresholdBps: '300',
  minimumAuthoritativeConfidenceBps: '5000',
};

function hash(seed: string): `0x${string}` {
  return `0x${seed.repeat(64).slice(0, 64)}`;
}

let database: Database;
let source: DrizzleMarketDataSource;
let available = false;

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping market integrity context tests');
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
  await seedChainAndBlock();
  source = new DrizzleMarketDataSource(database);
});

async function seedChainAndBlock(): Promise<void> {
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
}

async function seedSourceConfig(
  sourceKey: string,
  priority: number,
  minimumLiquidityRaw = 1n,
): Promise<void> {
  await database.client`
    INSERT INTO price_source_configs (
      source_key, source_type, asset_class, chain_id, source_asset_address,
      quote_asset_address, verification_source_url, verified_at,
      minimum_liquidity_raw, liquidity_decimals, maximum_staleness_seconds,
      enabled, priority, confidence_rules, route, methodology_version
    ) VALUES (
      ${sourceKey}, 'directDex', 'erc20', ${CHAIN_ID}, ${TOKEN.toLowerCase()},
      ${QUOTE.toLowerCase()}, 'https://pricing.example/verified',
      '2026-07-15T00:00:00.000Z', ${minimumLiquidityRaw.toString()}, 18, 3600, true, ${priority},
      ${JSON.stringify(PERMISSIVE_CONFIDENCE_RULES)}::jsonb, '[]'::jsonb, 'pricing-v1'
    )
  `;
}

async function seedObservation(input: {
  observationKey: string;
  sourceKey: string;
  priceRaw: bigint;
  liquidityDepthRaw?: bigint;
  priceImpactBps?: bigint;
}): Promise<void> {
  const liquidityDepthRaw =
    input.liquidityDepthRaw === undefined ? null : input.liquidityDepthRaw.toString();
  const priceImpactBps =
    input.priceImpactBps === undefined ? null : input.priceImpactBps.toString();
  await database.client`
    INSERT INTO deterministic_price_observations (
      observation_key, chain_id, token_address, quote_asset_address, source_key,
      source_type, route, price_raw, price_decimals, source_block_number,
      source_block_hash, source_timestamp, observed_at, confidence_bps, stale,
      status, authoritative, reasons, canonical, methodology_version,
      liquidity_depth_raw, liquidity_depth_decimals, price_impact_bps
    ) VALUES (
      ${input.observationKey}, ${CHAIN_ID}, ${TOKEN.toLowerCase()}, ${QUOTE.toLowerCase()},
      ${input.sourceKey}, 'directDex', '[]'::jsonb, ${input.priceRaw.toString()}, 18,
      ${BLOCK.toString()}, ${BLOCK_HASH}, '2026-07-15T10:00:00.000Z',
      '2026-07-15T10:00:00.000Z', 9500, false, 'available', true, '[]'::jsonb, true,
      'pricing-v1', ${liquidityDepthRaw}, 18, ${priceImpactBps}
    )
  `;
}

async function insertSwap(input: {
  logIndex: number;
  senderAddress: string;
  recipientAddress: string;
  side: 'buy' | 'sell';
}): Promise<void> {
  const transactionHash = hash((input.logIndex + 1).toString(16));
  const tokenIn = input.side === 'sell' ? TOKEN : QUOTE;
  const tokenOut = input.side === 'sell' ? QUOTE : TOKEN;
  await database.client`
    INSERT INTO swaps (
      chain_id, protocol_key, protocol_version, block_number, block_hash,
      transaction_hash, log_index, pool_address, sender_address, recipient_address,
      token_in_address, token_out_address, amount_in_raw, amount_out_raw, canonical
    ) VALUES (
      ${CHAIN_ID}, 'fixture-dex', 'v1', ${BLOCK.toString()}, ${BLOCK_HASH},
      ${transactionHash}, ${input.logIndex}, ${POOL.toLowerCase()},
      ${input.senderAddress.toLowerCase()}, ${input.recipientAddress.toLowerCase()},
      ${tokenIn.toLowerCase()}, ${tokenOut.toLowerCase()}, 1000, 990, true
    )
  `;
}

function loadMarket() {
  return source.load({ chainId: CHAIN_ID, tokenAddress: TOKEN, sourceBlock: BLOCK });
}

describe('DrizzleMarketDataSource (live DB)', () => {
  it('reports no disagreement when independent sources agree', async () => {
    await seedSourceConfig('dex-a', 1);
    await seedSourceConfig('dex-b', 2);
    await seedObservation({
      observationKey: 'a-at-100',
      sourceKey: 'dex-a',
      priceRaw: 2n * 10n ** 18n,
    });
    await seedObservation({
      observationKey: 'b-at-100',
      sourceKey: 'dex-b',
      priceRaw: 2n * 10n ** 18n,
    });

    const result = await loadMarket();

    expect(result.priceAvailable).toBe(true);
    expect(result.activeSourceCount).toBe(2);
    expect(result.disagreementWarnings).toEqual([]);
  });

  it('reports disagreement when independent sources diverge beyond the threshold', async () => {
    await seedSourceConfig('dex-a', 1);
    await seedSourceConfig('dex-usdg', 2);
    await seedObservation({
      observationKey: 'a-at-100',
      sourceKey: 'dex-a',
      priceRaw: 2n * 10n ** 18n,
    });
    // 10% higher than the primary: well past the 500bps disagreement threshold.
    await seedObservation({
      observationKey: 'usdg-at-100',
      sourceKey: 'dex-usdg',
      priceRaw: 22n * 10n ** 17n,
    });

    const result = await loadMarket();

    expect(result.priceAvailable).toBe(true);
    expect(result.activeSourceCount).toBe(2);
    expect(result.disagreementWarnings).toEqual(['SOURCE_DISAGREEMENT:dex-usdg:1000']);
  });

  it('reports price unavailable when the token has no active source configs', async () => {
    const result = await loadMarket();

    expect(result.priceAvailable).toBe(false);
    expect(result.activeSourceCount).toBe(0);
  });

  it('does not observe self-trading in a clean market below the manipulation threshold', async () => {
    for (let index = 0; index < 10; index += 1) {
      await insertSwap({
        logIndex: index,
        senderAddress: ROUTER,
        recipientAddress: index % 2 === 0 ? WALLET_A : WALLET_B,
        side: index % 2 === 0 ? 'buy' : 'sell',
      });
    }

    const result = await loadMarket();

    expect(result.tradesAvailable).toBe(true);
    expect(result.tradeCount).toBe(10);
    expect(
      result.manipulation.signals.some((s) => s.code === 'SELF_TRADING' && s.status === 'observed'),
    ).toBe(false);
  });

  it('observes self-trading once trade volume crosses the 20-trade threshold', async () => {
    for (let index = 0; index < 25; index += 1) {
      // Same wallet on both sides of every swap: a textbook self-trade.
      await insertSwap({
        logIndex: index,
        senderAddress: WALLET_A,
        recipientAddress: WALLET_A,
        side: index % 2 === 0 ? 'buy' : 'sell',
      });
    }

    const result = await loadMarket();

    expect(result.tradesAvailable).toBe(true);
    expect(result.tradeCount).toBe(25);
    expect(result.tradeCount).toBeGreaterThanOrEqual(20);
    const selfTrading = result.manipulation.signals.find((s) => s.code === 'SELF_TRADING');
    expect(selfTrading?.status).toBe('observed');
  });

  it('observes thin-pool manipulation when the selected source liquidity is below its configured minimum', async () => {
    await seedSourceConfig('dex-a', 1, 5_000n);
    await seedObservation({
      observationKey: 'a-at-100',
      sourceKey: 'dex-a',
      priceRaw: 2n * 10n ** 18n,
      liquidityDepthRaw: 1_000n,
      priceImpactBps: 1_500n,
    });
    for (let index = 0; index < 20; index += 1) {
      await insertSwap({
        logIndex: index,
        senderAddress: ROUTER,
        recipientAddress: index % 2 === 0 ? WALLET_A : WALLET_B,
        side: index % 2 === 0 ? 'buy' : 'sell',
      });
    }

    const result = await loadMarket();

    expect(result.tradeCount).toBeGreaterThanOrEqual(20);
    expect(result.priceAvailable).toBe(true);
    const thinPool = result.manipulation.signals.find(
      (s) => s.code === 'THIN_POOL_PRICE_MANIPULATION',
    );
    expect(thinPool?.status).toBe('observed');
  });

  it('does not observe thin-pool manipulation when the selected source liquidity is above its configured minimum', async () => {
    await seedSourceConfig('dex-a', 1, 5_000n);
    await seedObservation({
      observationKey: 'a-at-100',
      sourceKey: 'dex-a',
      priceRaw: 2n * 10n ** 18n,
      liquidityDepthRaw: 50_000n,
      priceImpactBps: 1_500n,
    });
    for (let index = 0; index < 20; index += 1) {
      await insertSwap({
        logIndex: index,
        senderAddress: ROUTER,
        recipientAddress: index % 2 === 0 ? WALLET_A : WALLET_B,
        side: index % 2 === 0 ? 'buy' : 'sell',
      });
    }

    const result = await loadMarket();

    expect(result.tradeCount).toBeGreaterThanOrEqual(20);
    expect(result.priceAvailable).toBe(true);
    const thinPool = result.manipulation.signals.find(
      (s) => s.code === 'THIN_POOL_PRICE_MANIPULATION',
    );
    expect(thinPool?.status).toBe('notObserved');
  });
});
