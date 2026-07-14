import { RPCClient, getChainDefinition } from '@hood-sentry/chain';
import { getEnv } from '@hood-sentry/config';
import { createDatabase } from '@hood-sentry/db';
import { createLogger } from '@hood-sentry/observability';
import {
  BlockFetcher,
  BlockIndexer,
  BlockPersister,
  CheckpointManager,
  GapScanner,
  ReorgDetector,
} from './index.js';
import type { IndexerConfig, IndexerMode } from './types.js';

async function main() {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'indexer' });

  let isShuttingDown = false;
  let indexer: BlockIndexer | null = null;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutdown signal received', { signal });

    if (indexer) {
      await indexer.stop();
    }

    logger.info('Indexer stopped gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    const args = process.argv.slice(2);
    const mode = (args.find((arg) => arg.startsWith('--mode='))?.split('=')[1] ??
      'live') as IndexerMode;
    const startBlock = args.find((arg) => arg.startsWith('--start-block='))?.split('=')[1];
    const endBlock = args.find((arg) => arg.startsWith('--end-block='))?.split('=')[1];
    const batchSize = args.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1];

    logger.info('Indexer starting', {
      mode,
      chainId: env.ROBINHOOD_CHAIN_ID,
      secondaryRpcConfigured: env.ROBINHOOD_RPC_SECONDARY !== undefined,
      startBlock,
      endBlock,
      batchSize,
    });

    const db = createDatabase(env.DATABASE_URL);

    const chain = getChainDefinition(env.ROBINHOOD_CHAIN_ID);
    const rpcClient = new RPCClient(chain, {
      chainId: env.ROBINHOOD_CHAIN_ID,
      primary: {
        url: env.ROBINHOOD_RPC_PRIMARY,
        type: 'http',
        role: 'primary',
        timeout: 30000,
      },
      secondary: env.ROBINHOOD_RPC_SECONDARY
        ? {
            url: env.ROBINHOOD_RPC_SECONDARY,
            type: 'http',
            role: 'secondary',
            timeout: 30000,
          }
        : undefined,
      healthCheck: {
        intervalMs: 30000,
        timeoutMs: 10000,
        maxBlockLag: 100,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenMaxRequests: 3,
      },
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
      },
    });

    const config: IndexerConfig = {
      chainId: BigInt(env.ROBINHOOD_CHAIN_ID),
      workerId: `indexer-${process.pid}-${Date.now()}`,
      mode,
      batchSize: batchSize ? Number.parseInt(batchSize) : 10,
      pollIntervalMs: 1000,
      leaseDurationMs: 60000,
      leaseRenewalMs: 30000,
      maxRetries: 3,
      retryDelayMs: 1000,
      startBlock: startBlock ? BigInt(startBlock) : undefined,
      endBlock: endBlock ? BigInt(endBlock) : undefined,
      finalityConfirmations: 64,
      safeConfirmations: 32,
    };

    const checkpointManager = new CheckpointManager(db, config);
    const blockFetcher = new BlockFetcher(rpcClient, config, logger);
    const blockPersister = new BlockPersister(db, config, logger);
    const reorgDetector = new ReorgDetector(db, blockFetcher, config, logger);
    const gapScanner = new GapScanner(db, config, logger);

    indexer = new BlockIndexer(
      db,
      checkpointManager,
      blockFetcher,
      blockPersister,
      reorgDetector,
      gapScanner,
      config,
      logger,
    );

    await indexer.start();
  } catch (err) {
    logger.error('Indexer failed to start', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  }
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: fatal startup error
  console.error('Indexer failed:', err);
  process.exit(1);
});
