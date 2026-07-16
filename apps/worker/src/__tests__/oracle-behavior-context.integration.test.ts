import { type Database, DrizzlePricingRepository, createDatabase } from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import { getAddress } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleOracleObservationSource } from '../jobs/oracle-behavior-context.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';
const CHAIN_ID = 4664;
const TOKEN = getAddress('0x2000000000000000000000000000000000000009');
const UNCONFIGURED_TOKEN = getAddress('0x200000000000000000000000000000000000000a');
const QUOTE = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
const FEED = getAddress('0x4000000000000000000000000000000000000001');
const SEQUENCER_FEED = getAddress('0x4000000000000000000000000000000000000002');
const SOURCE_KEY = 'chainlink-token-usd-fixture';

const ZERO_CONFIDENCE_RULES = {
  baseConfidenceBps: '10000',
  thinLiquidityPenaltyBps: '0',
  stalePenaltyBps: '0',
  disagreementThresholdBps: '0',
  disagreementPenaltyBps: '0',
  maximumPriceImpactBps: '0',
  maximumSingleTransactionVolumeBps: '0',
  maximumPriceJumpBps: '0',
  stablecoinDepegThresholdBps: '0',
  minimumAuthoritativeConfidenceBps: '0',
};

function hash(seed: string): `0x${string}` {
  return `0x${seed.repeat(64).slice(0, 64)}`;
}

let database: Database;
let source: DrizzleOracleObservationSource;
let available = false;

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping oracle behavior context tests');
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
  source = new DrizzleOracleObservationSource(new DrizzlePricingRepository(database.db));
});

async function seedChainlinkSourceConfig(): Promise<void> {
  await database.client`
    INSERT INTO price_source_configs (
      source_key, source_type, asset_class, chain_id, source_contract_address,
      source_asset_address, quote_asset_address, verification_source_url, verified_at,
      minimum_liquidity_raw, liquidity_decimals, maximum_staleness_seconds,
      enabled, priority, confidence_rules, route, methodology_version,
      oracle_heartbeat_seconds, sequencer_feed_address
    ) VALUES (
      ${SOURCE_KEY}, 'chainlink', 'erc20', ${CHAIN_ID}, ${FEED.toLowerCase()},
      ${TOKEN.toLowerCase()}, ${QUOTE.toLowerCase()}, 'https://oracle.example/verified',
      '2026-07-15T00:00:00.000Z', 0, 18, 3600, true, 1,
      ${JSON.stringify(ZERO_CONFIDENCE_RULES)}::jsonb, '[]'::jsonb, 'pricing-v1',
      3600, ${SEQUENCER_FEED.toLowerCase()}
    )
  `;
}

async function seedObservation(input: {
  observationKey: string;
  sourceBlockNumber: bigint;
  oraclePaused: boolean;
  sequencerUp: boolean | null;
  roundId: bigint;
  answeredInRound: bigint;
}): Promise<void> {
  await database.client`
    INSERT INTO deterministic_price_observations (
      observation_key, chain_id, token_address, quote_asset_address, source_key,
      source_type, source_contract_address, route, price_raw, price_decimals,
      source_block_number, source_block_hash, source_timestamp, observed_at,
      confidence_bps, stale, status, authoritative, reasons, canonical,
      methodology_version, round_id, answered_in_round, oracle_paused, sequencer_up
    ) VALUES (
      ${input.observationKey}, ${CHAIN_ID}, ${TOKEN.toLowerCase()}, ${QUOTE.toLowerCase()},
      ${SOURCE_KEY}, 'chainlink', ${FEED.toLowerCase()}, '[]'::jsonb,
      ${(3n * 10n ** 8n).toString()}, 8, ${input.sourceBlockNumber.toString()}, ${hash('a')},
      '2026-07-15T10:00:00.000Z', '2026-07-15T10:00:05.000Z', 9500, false, 'available', true,
      '[]'::jsonb, true, 'pricing-v1', ${input.roundId.toString()}, ${input.answeredInRound.toString()},
      ${input.oraclePaused}, ${input.sequencerUp}
    )
  `;
}

describe('DrizzleOracleObservationSource (live DB)', () => {
  it('reports the token not applicable when it has no oracle source', async () => {
    const result = await source.load({
      chainId: CHAIN_ID,
      tokenAddress: UNCONFIGURED_TOKEN,
      sourceBlock: 200n,
      scanTimeSeconds: 1_800_000_000n,
    });

    expect(result.applicable).toBe(false);
    expect(result.sourceKey).toBeNull();
    expect(result.answerRaw).toBeNull();
    expect(result.oraclePaused).toBe(false);
    expect(result.sequencerConfigured).toBe(false);
    expect(result.sourceBlock).toBe(200n);
  });

  it('projects paused/sequencer state from the pinned observation', async () => {
    await seedChainlinkSourceConfig();
    await seedObservation({
      observationKey: 'chainlink-token-usd-at-200',
      sourceBlockNumber: 200n,
      oraclePaused: true,
      sequencerUp: false,
      roundId: 42n,
      answeredInRound: 42n,
    });

    const result = await source.load({
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      sourceBlock: 200n,
      scanTimeSeconds: 1_800_000_000n,
    });

    expect(result.applicable).toBe(true);
    expect(result.sourceKey).toBe(SOURCE_KEY);
    expect(result.heartbeatSeconds).toBe(3600);
    expect(result.sequencerConfigured).toBe(true);
    expect(result.oraclePaused).toBe(true);
    expect(result.sequencerUp).toBe(false);
    expect(result.answerRaw).toBe(3n * 10n ** 8n);
    expect(result.decimals).toBe(8);
    expect(result.roundId).toBe(42n);
    expect(result.answeredInRound).toBe(42n);
    expect(result.updatedAtSeconds).toBe(
      BigInt(Math.floor(Date.parse('2026-07-15T10:00:00.000Z') / 1000)),
    );
    expect(result.sourceBlock).toBe(200n);
  });

  it('withholds the answer when the only observation on record is ahead of the pinned scan block', async () => {
    await seedChainlinkSourceConfig();
    await seedObservation({
      observationKey: 'chainlink-token-usd-at-201',
      sourceBlockNumber: 201n,
      oraclePaused: false,
      sequencerUp: true,
      roundId: 43n,
      answeredInRound: 43n,
    });

    const result = await source.load({
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      sourceBlock: 200n,
      scanTimeSeconds: 1_800_000_000n,
    });

    expect(result.applicable).toBe(true);
    expect(result.sourceKey).toBe(SOURCE_KEY);
    expect(result.answerRaw).toBeNull();
    expect(result.roundId).toBeNull();
    expect(result.oraclePaused).toBe(false);
    expect(result.sequencerUp).toBeNull();
  });
});
