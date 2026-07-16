import { ProtocolAdapterManager } from '@hood-sentry/chain';
import { type Database, createDatabase } from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import type { ProxyAnalysisClient } from '@hood-sentry/risk-engine';
import { type Address, type Hash, type Hex, getAddress } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContractMetadataProvider } from '../jobs/contract-analysis-context.js';
import type { PinnedBlockClient } from '../jobs/pinned-risk-context.js';
import { createRiskAnalysisRuntime } from '../jobs/risk-runtime.js';

/**
 * End-to-end coverage for the full risk-scan context chain: a scan run through
 * `createRiskAnalysisRuntime` must reach the oracle and market-integrity rule
 * families, not just the contract/liquidity/holder chain that predates them.
 *
 * The oracle and market-integrity rule families are already registered in
 * `ALL_RULES` (they always contribute a finding per rule, since a rule's
 * `category` is attached independent of whether its data was available). That
 * means "the category appears in `findings`" is true even when the two context
 * loaders are NOT wired -- the rules simply report `unknown` for missing data.
 * So the assertion here also pins a specific rule's status to `not_applicable`,
 * which only happens once the loader has supplied a real (if empty) oracle /
 * market-integrity reading for the target. That is what actually distinguishes
 * "wired" from "unwired".
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';

const CHAIN_ID = 4663;
const TOKEN = getAddress('0x9000000000000000000000000000000000000001');
const BLOCK = 100n;
const BLOCK_HASH = hash('a');

function hash(seed: string): Hash {
  return `0x${seed.repeat(64).slice(0, 64)}` as Hash;
}

/** A chain client with no bytecode, storage, logs, or oracle/market activity for the target. */
class EmptyChainFixture implements ProxyAnalysisClient, PinnedBlockClient {
  async getCode(): Promise<Hex> {
    return '0x';
  }

  async getStorageAt(): Promise<Hex> {
    return '0x';
  }

  async call(): Promise<Hex> {
    return '0x';
  }

  async getLogs(): Promise<[]> {
    return [];
  }

  async getChainId(): Promise<number> {
    return CHAIN_ID;
  }

  async getBlock(): Promise<{ hash: Hash | null }> {
    return { hash: BLOCK_HASH };
  }
}

const metadataProvider: ContractMetadataProvider = {
  async enrichContract() {
    return { status: 'unavailable', metadata: null, warnings: [], cacheStatus: 'miss' };
  },
};

let database: Database;
let available = false;

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping risk scan integration tests');
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
  await database.client`
    INSERT INTO blocks (
      chain_id, number, hash, parent_hash, timestamp, finality_state, canonical
    ) VALUES (
      ${CHAIN_ID}, ${BLOCK.toString()}, ${BLOCK_HASH}, ${hash('parent')},
      '2026-07-15T10:00:00.000Z', 'finalized', true
    )
  `;
});

describe('risk scan runtime', () => {
  it('reaches the oracle and market-integrity rule families for a scanned token', async () => {
    const runtime = createRiskAnalysisRuntime({
      database,
      chainId: CHAIN_ID,
      chainClient: new EmptyChainFixture(),
      protocolManager: new ProtocolAdapterManager([]),
      metadataProvider,
    });

    const outcome = await runtime.run({
      target: { type: 'token', chainId: CHAIN_ID, address: TOKEN as Address },
      sourceBlock: BLOCK,
      sourceBlockHash: BLOCK_HASH,
      trigger: 'new_token',
    });

    expect(outcome.duplicate).toBe(false);
    const findings = outcome.result?.findings ?? [];
    const categories = new Set(findings.map((finding) => finding.category));
    expect(categories.has('Oracle behavior')).toBe(true);
    expect(categories.has('Market integrity')).toBe(true);

    // A token with no configured oracle must be reported `not_applicable`, not
    // `unknown` -- `unknown` is what an unwired loader (missing data source)
    // produces, so this is the assertion that actually proves the wiring.
    const oracleFinding = findings.find((finding) => finding.ruleId === 'oracle.oracle_stale');
    expect(oracleFinding?.status).toBe('not_applicable');

    // Likewise, a token with fewer than the minimum trade count for assessment
    // must be reported `not_applicable` once the market data source is wired.
    const marketFinding = findings.find(
      (finding) => finding.ruleId === 'market.tiny_trade_count_inflation',
    );
    expect(marketFinding?.status).toBe('not_applicable');
  });
});
