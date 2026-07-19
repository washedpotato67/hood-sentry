import {
  ProtocolValidationService,
  RPCClient,
  ResilientProtocolClient,
  createProtocolAdapterRuntime,
  getChainDefinition,
  protocolRegistry,
} from '@hood-sentry/chain';
import { getEnv } from '@hood-sentry/config';
import {
  DrizzlePricingRepository,
  DrizzleProtocolRepositoryImpl,
  type ProtocolRepository,
  createDatabase,
} from '@hood-sentry/db';
import { type Logger, createLogger } from '@hood-sentry/observability';
import { resolveRpcProviders } from '@hood-sentry/providers';
import {
  type DerivedJobPublisher,
  QueueJobPublisher,
  createQueueConnection,
} from '@hood-sentry/queue';
import { ProtocolEventsHandler } from './handlers/protocol-events.js';
import {
  BlockFetcher,
  BlockIndexer,
  BlockPersister,
  ChainlinkJobProducer,
  CheckpointManager,
  GapScanner,
  ReorgDetector,
} from './index.js';
import type { IndexerConfig, IndexerMode } from './types.js';

interface IndexerArguments {
  mode: IndexerMode;
  startBlock?: string;
  endBlock?: string;
  batchSize?: string;
}

function parseMode(value: string | undefined): IndexerMode {
  switch (value ?? 'live') {
    case 'live':
      return 'live';
    case 'historical':
      return 'historical';
    case 'gap-repair':
      return 'gap-repair';
    case 'reorg-reconciliation':
      return 'reorg-reconciliation';
    case 'contract-replay':
      return 'contract-replay';
    default:
      throw new Error(`Unsupported indexer mode: ${value}`);
  }
}

function readArguments(args: readonly string[]): IndexerArguments {
  const value = (name: string) =>
    args.find((argument) => argument.startsWith(`--${name}=`))?.split('=')[1];
  return {
    mode: parseMode(value('mode')),
    startBlock: value('start-block'),
    endBlock: value('end-block'),
    batchSize: value('batch-size'),
  };
}

async function initializeProtocolEvents(request: {
  rpcClient: RPCClient;
  chainId: number;
  tradingEnabled: boolean;
  mainnetWritesEnabled: boolean;
  repository: ProtocolRepository;
  publisher: DerivedJobPublisher;
  logger: Logger;
}): Promise<{ handler: ProtocolEventsHandler; validation: ProtocolValidationService }> {
  const chainRegistry = {
    ...protocolRegistry,
    protocols: protocolRegistry.protocols.filter(
      (definition) => definition.chainId === request.chainId,
    ),
  };
  const protocolClient = new ResilientProtocolClient(request.rpcClient);
  const validation = new ProtocolValidationService(chainRegistry, protocolClient, {
    onAlert: (alert) => request.logger.error('Protocol adapter disabled', { ...alert }),
  });
  const runtime = await createProtocolAdapterRuntime({
    registry: chainRegistry,
    chainId: request.chainId,
    client: protocolClient,
    validation,
    featurePolicy: {
      async assertTradingEnabled(chainId) {
        if (!request.tradingEnabled) throw new Error('TRADING_ENABLED is disabled');
        if (chainId === 4663 && !request.mainnetWritesEnabled) {
          throw new Error('MAINNET_WRITES_ENABLED is disabled');
        }
      },
    },
  });
  for (const error of runtime.initializationErrors) {
    request.logger.error('Protocol adapter initialization failed', { error });
  }
  for (const result of runtime.validationResults) {
    const definition = chainRegistry.protocols.find(
      (candidate) =>
        candidate.protocolKey === result.protocolKey &&
        candidate.protocolVersion === result.protocolVersion &&
        candidate.chainId === result.chainId,
    );
    if (definition !== undefined) {
      await request.repository.saveProtocolValidation(definition, result, chainRegistry.version);
    }
  }
  const activePools = await request.repository.getActivePools(request.chainId);
  for (const pool of activePools) {
    try {
      runtime.manager.registerPool(pool);
    } catch (error) {
      request.logger.warn('Skipping pool owned by an inactive adapter', {
        poolAddress: pool.poolAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const handler = new ProtocolEventsHandler(
    runtime.manager,
    request.repository,
    request.publisher,
    request.logger,
  );
  return { handler, validation };
}

async function main() {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'indexer' });

  let isShuttingDown = false;
  let indexer: BlockIndexer | null = null;
  const queueConnection = createQueueConnection(env.REDIS_URL);
  const jobPublisher = new QueueJobPublisher({ connection: queueConnection });

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutdown signal received', { signal });

    if (indexer) {
      await indexer.stop();
    }
    await jobPublisher.close();
    await queueConnection.quit();

    logger.info('Indexer stopped gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    const { mode, startBlock, endBlock, batchSize } = readArguments(process.argv.slice(2));
    const rpcProviders = resolveRpcProviders({
      chainId: env.ROBINHOOD_CHAIN_ID,
      alchemyApiKey: env.ALCHEMY_API_KEY,
      primaryRpcUrl: env.ROBINHOOD_RPC_PRIMARY,
      secondaryRpcUrl: env.ROBINHOOD_RPC_SECONDARY,
      primaryWebsocketUrl: env.ROBINHOOD_WS_PRIMARY,
      secondaryWebsocketUrl: env.ROBINHOOD_WS_SECONDARY,
    });

    const db = createDatabase(env.DATABASE_URL);

    const chain = getChainDefinition(env.ROBINHOOD_CHAIN_ID);
    // Each block costs two RPC calls (body plus receipts), and the provider's
    // free tier meters HTTP requests per second, not calls. Batching lets one
    // request carry a whole window of blocks; a size of 1 disables it.
    const rpcBatch =
      env.RPC_BATCH_MAX_CALLS > 1
        ? { maxCallsPerRequest: env.RPC_BATCH_MAX_CALLS, waitMs: env.RPC_BATCH_WAIT_MS }
        : undefined;
    const rpcClient = new RPCClient(chain, {
      chainId: env.ROBINHOOD_CHAIN_ID,
      primary: {
        url: rpcProviders.primary.url,
        type: 'http',
        role: 'primary',
        timeout: 30000,
        batch: rpcBatch,
      },
      secondary: rpcProviders.secondary
        ? {
            url: rpcProviders.secondary.url,
            type: 'http',
            role: 'secondary',
            timeout: 30000,
            batch: rpcBatch,
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

    const finalityConfirmations = 64n;
    // Precedence: an explicit --start-block wins for one-off runs; otherwise
    // INDEXER_START_BLOCK decides where a checkpoint-less live indexer begins.
    // `latest` resolves to a confirmed block just behind the head so we index
    // recent activity immediately instead of crawling from genesis.
    let resolvedStartBlock: bigint | undefined;
    if (startBlock !== undefined) {
      resolvedStartBlock = BigInt(startBlock);
    } else if (env.INDEXER_START_BLOCK === 'latest') {
      const head = await rpcClient.getBlockNumber();
      resolvedStartBlock = head > finalityConfirmations ? head - finalityConfirmations : 0n;
      logger.info('Resolved start block from chain head', {
        head: head.toString(),
        startBlock: resolvedStartBlock.toString(),
      });
    } else if (env.INDEXER_START_BLOCK !== undefined) {
      resolvedStartBlock = BigInt(env.INDEXER_START_BLOCK);
    }

    logger.info('Indexer starting', {
      mode,
      chainId: env.ROBINHOOD_CHAIN_ID,
      primaryRpcProvider: rpcProviders.primary.providerId,
      secondaryRpcConfigured: rpcProviders.secondary !== null,
      startBlock: resolvedStartBlock?.toString(),
      endBlock,
      batchSize,
    });

    const config: IndexerConfig = {
      chainId: BigInt(env.ROBINHOOD_CHAIN_ID),
      workerId: `indexer-${process.pid}-${Date.now()}`,
      mode,
      batchSize: batchSize ? Number.parseInt(batchSize) : 10,
      maxConcurrency: env.INDEXER_MAX_CONCURRENCY,
      logWindowEnabled: env.INDEXER_LOG_WINDOW_ENABLED,
      pollIntervalMs: 1000,
      leaseDurationMs: 60000,
      leaseRenewalMs: 30000,
      maxRetries: 3,
      retryDelayMs: 1000,
      startBlock: resolvedStartBlock,
      endBlock: endBlock ? BigInt(endBlock) : undefined,
      finalityConfirmations: Number(finalityConfirmations),
      safeConfirmations: 32,
    };

    const protocolRepository = new DrizzleProtocolRepositoryImpl(db.db);
    const pricingRepository = new DrizzlePricingRepository(db.db);
    const protocolEvents = await initializeProtocolEvents({
      rpcClient,
      chainId: env.ROBINHOOD_CHAIN_ID,
      tradingEnabled: env.TRADING_ENABLED,
      mainnetWritesEnabled: env.MAINNET_WRITES_ENABLED,
      repository: protocolRepository,
      publisher: jobPublisher,
      logger,
    });

    const checkpointManager = new CheckpointManager(db, config);
    const blockFetcher = new BlockFetcher(rpcClient, config, logger);
    const blockPersister = new BlockPersister(db, config, logger);
    const reorgDetector = new ReorgDetector(
      db,
      blockFetcher,
      config,
      logger,
      protocolRepository,
      pricingRepository,
    );
    const gapScanner = new GapScanner(db, config, logger);
    const chainlinkJobProducer = new ChainlinkJobProducer({
      chainId: env.ROBINHOOD_CHAIN_ID,
      repository: pricingRepository,
      publisher: jobPublisher,
      logger,
    });

    indexer = new BlockIndexer(
      db,
      checkpointManager,
      blockFetcher,
      blockPersister,
      reorgDetector,
      gapScanner,
      config,
      logger,
      protocolEvents.handler,
      jobPublisher,
      chainlinkJobProducer,
    );

    protocolEvents.validation.startPeriodicRevalidation();

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
