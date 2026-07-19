import type { RPCClient } from '@hood-sentry/chain';
import { type Database, createDatabase } from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import { createLogger } from '@hood-sentry/observability';
import type { DerivedJobInput, DerivedJobPublisher } from '@hood-sentry/queue';
import { BlockFetcher } from '../block-fetcher.js';
import { BlockIndexer } from '../block-indexer.js';
import { BlockPersister } from '../block-persister.js';
import { CheckpointManager } from '../checkpoint-manager.js';
import { GapScanner } from '../gap-scanner.js';
import { ReorgDetector } from '../reorg-detector.js';
import type { IndexerConfig } from '../types.js';
import { FakeRpcClient, type RpcFaults, type SyntheticChain } from './synthetic-chain.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';

export const CHAIN_ID = 4663n;

/** chain_id is an INTEGER column, and postgres.js does not bind bigint parameters. */
export const CHAIN_ID_SQL = Number(CHAIN_ID);

/** Captures every job the indexer publishes, standing in for the durable queue. */
export class RecordingPublisher implements DerivedJobPublisher {
  readonly published: Array<{ job: DerivedJobInput; idempotencyKey: string }> = [];

  async publish(job: DerivedJobInput, idempotencyKey: string): Promise<void> {
    this.published.push({ job, idempotencyKey });
  }

  keysOfType(type: string): string[] {
    return this.published.filter((p) => p.job.type === type).map((p) => p.idempotencyKey);
  }
}

export function testConfig(overrides: Partial<IndexerConfig> = {}): IndexerConfig {
  return {
    chainId: CHAIN_ID,
    workerId: 'worker-a',
    mode: 'live',
    batchSize: 10,
    maxConcurrency: 3,
    logWindowEnabled: false,
    pollIntervalMs: 5,
    leaseDurationMs: 60_000,
    leaseRenewalMs: 30_000,
    maxRetries: 3,
    retryDelayMs: 5,
    finalityConfirmations: 10,
    safeConfirmations: 5,
    ...overrides,
  };
}

export interface TestIndexer {
  indexer: BlockIndexer;
  publisher: RecordingPublisher;
  rpc: FakeRpcClient;
  checkpointManager: CheckpointManager;
  config: IndexerConfig;
}

export function buildIndexer(
  database: Database,
  chain: SyntheticChain,
  overrides: Partial<IndexerConfig> = {},
  faults: RpcFaults = {},
): TestIndexer {
  const config = testConfig(overrides);
  const logger = createLogger({ level: 'fatal', service: 'indexer-test' });
  const rpc = new FakeRpcClient(chain, faults);
  const blockFetcher = new BlockFetcher(rpc as unknown as RPCClient, config, logger);
  const blockPersister = new BlockPersister(database, config, logger);
  const reorgDetector = new ReorgDetector(database, blockFetcher, config, logger);
  const gapScanner = new GapScanner(database, config, logger);
  const checkpointManager = new CheckpointManager(database, config);
  const publisher = new RecordingPublisher();

  const indexer = new BlockIndexer(
    database,
    checkpointManager,
    blockFetcher,
    blockPersister,
    reorgDetector,
    gapScanner,
    config,
    logger,
    undefined,
    publisher,
  );

  return { indexer, publisher, rpc, checkpointManager, config };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
  label = 'condition',
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/**
 * Live mode loops forever, so drive it until `predicate` holds, then stop it and
 * surface any error the run threw.
 */
export async function runLiveUntil(
  indexer: BlockIndexer,
  predicate: () => boolean | Promise<boolean>,
  label = 'condition',
): Promise<void> {
  let runError: unknown;
  const running = indexer.start().catch((error: unknown) => {
    runError = error;
  });

  try {
    await waitFor(async () => runError !== undefined || (await predicate()), 10_000, label);
  } finally {
    await indexer.stop();
    await running;
  }

  if (runError !== undefined) throw runError;
}

/** A migrated database with the chain row the fact tables reference. */
export async function createTestDatabase(): Promise<Database> {
  const database = createDatabase(TEST_DATABASE_URL);
  await resetAndMigrate(database.client);
  await database.client`
    INSERT INTO chains (chain_id, name, native_symbol, enabled)
    VALUES (${CHAIN_ID_SQL}, 'Robinhood Chain Test', 'ETH', true)
    ON CONFLICT (chain_id) DO NOTHING
  `;
  return database;
}

export async function isDatabaseAvailable(): Promise<boolean> {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}
