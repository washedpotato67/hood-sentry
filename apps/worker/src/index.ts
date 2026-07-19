import {
  BlockscoutClient,
  OracleClient,
  ProtocolValidationService,
  RPCClient,
  ResilientProtocolClient,
  createProtocolAdapterRuntime,
  getChainDefinition,
  protocolRegistry,
} from '@hood-sentry/chain';
import { getEnv } from '@hood-sentry/config';
import {
  DatabaseBlockscoutCache,
  DrizzleDiscoveryRepository,
  DrizzleDiscoverySourceRepository,
  DrizzlePricingRepository,
  DrizzleProtocolRepositoryImpl,
  createDatabase,
} from '@hood-sentry/db';
import { PriceSourceActivationService } from '@hood-sentry/market-engine';
import { createLogger } from '@hood-sentry/observability';
import {
  ResendEmailProvider,
  SignedWebhookProvider,
  TelegramBotProvider,
  WebPushProvider,
  resolveRpcProviders,
} from '@hood-sentry/providers';
import { createDerivedJobWorker, createQueueConnection } from '@hood-sentry/queue';
import { createDerivedJobRouter } from './derived-job-router.js';
import { DiscoveryRefreshJob } from './jobs/discovery-refresh.js';
import { PoolRefreshJob } from './jobs/pool-refresh.js';
import { ProtocolEnrichmentJob } from './jobs/protocol-enrichment.js';
import { createRiskAnalysisRuntime } from './jobs/risk-runtime.js';
import { AlertDeliveryService } from './notifications/alert-delivery.js';
import { RiskAlertService } from './notifications/risk-alerts.js';
import { ChainlinkSourceVerifier } from './verifiers/chainlink.js';

async function main() {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'worker' });

  let isShuttingDown = false;

  const database = createDatabase(env.DATABASE_URL);
  const workerConnection = createQueueConnection(env.REDIS_URL);
  const deadLetterConnection = createQueueConnection(env.REDIS_URL);
  const chain = getChainDefinition(env.ROBINHOOD_CHAIN_ID);
  const rpcProviders = resolveRpcProviders({
    chainId: env.ROBINHOOD_CHAIN_ID,
    alchemyApiKey: env.ALCHEMY_API_KEY,
    primaryRpcUrl: env.ROBINHOOD_RPC_PRIMARY,
    secondaryRpcUrl: env.ROBINHOOD_RPC_SECONDARY,
    primaryWebsocketUrl: env.ROBINHOOD_WS_PRIMARY,
    secondaryWebsocketUrl: env.ROBINHOOD_WS_SECONDARY,
  });
  const rpcClient = new RPCClient(chain, {
    chainId: env.ROBINHOOD_CHAIN_ID,
    primary: {
      url: rpcProviders.primary.url,
      type: 'http',
      role: 'primary',
      timeout: env.RPC_TIMEOUT_MS,
    },
    secondary: rpcProviders.secondary
      ? {
          url: rpcProviders.secondary.url,
          type: 'http',
          role: 'secondary',
          timeout: env.RPC_TIMEOUT_MS,
        }
      : undefined,
    healthCheck: {
      intervalMs: 30_000,
      timeoutMs: env.RPC_TIMEOUT_MS,
      maxBlockLag: 100,
    },
    circuitBreaker: {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxRequests: 3,
    },
    retry: {
      maxAttempts: env.RPC_MAX_RETRIES + 1,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      backoffMultiplier: 2,
    },
  });
  const oracleClient = new OracleClient({
    rpcClient,
    chainId: env.ROBINHOOD_CHAIN_ID,
  });

  const pricingRepository = new DrizzlePricingRepository(database.db);
  const chainlinkVerifier = new ChainlinkSourceVerifier({ oracleClient });
  const chainlinkActivation = new PriceSourceActivationService(chainlinkVerifier);
  const chainlinkConfigs = (
    await pricingRepository.listSourceConfigs(env.ROBINHOOD_CHAIN_ID)
  ).filter((config) => config.sourceType === 'chainlink');
  const activationResults = await chainlinkActivation.validate(chainlinkConfigs);
  const failedActivations = activationResults.filter((result) => !result.active);
  if (failedActivations.length > 0) {
    for (const failure of failedActivations) {
      logger.fatal('Chainlink source verification failed', {
        sourceKey: failure.config.sourceKey,
        reason: failure.reason,
      });
    }
    throw new Error('CHAINLINK_SOURCE_VERIFICATION_FAILED');
  }

  const metadataProvider = new BlockscoutClient({
    apiBaseUrl: env.BLOCKSCOUT_API_BASE,
    apiKey: env.BLOCKSCOUT_API_KEY,
    cache: new DatabaseBlockscoutCache(database.db),
    timeoutMs: env.RPC_TIMEOUT_MS,
  });
  const chainRegistry = {
    ...protocolRegistry,
    protocols: protocolRegistry.protocols.filter(
      (definition) => definition.chainId === env.ROBINHOOD_CHAIN_ID,
    ),
  };
  const protocolClient = new ResilientProtocolClient(rpcClient);
  const protocolValidation = new ProtocolValidationService(chainRegistry, protocolClient, {
    onAlert: (alert) => logger.error('Protocol adapter disabled', { ...alert }),
  });
  const protocolRuntime = await createProtocolAdapterRuntime({
    registry: chainRegistry,
    chainId: env.ROBINHOOD_CHAIN_ID,
    client: protocolClient,
    validation: protocolValidation,
    featurePolicy: {
      async assertTradingEnabled(chainId) {
        if (!env.TRADING_ENABLED) throw new Error('TRADING_ENABLED is disabled');
        if (chainId === 4663 && !env.MAINNET_WRITES_ENABLED) {
          throw new Error('MAINNET_WRITES_ENABLED is disabled');
        }
      },
    },
  });
  const protocolRepository = new DrizzleProtocolRepositoryImpl(database.db);
  for (const result of protocolRuntime.validationResults) {
    const definition = chainRegistry.protocols.find(
      (candidate) =>
        candidate.protocolKey === result.protocolKey &&
        candidate.protocolVersion === result.protocolVersion &&
        candidate.chainId === result.chainId,
    );
    if (definition !== undefined) {
      await protocolRepository.saveProtocolValidation(definition, result, chainRegistry.version);
    }
  }
  for (const error of protocolRuntime.initializationErrors) {
    logger.error('Protocol adapter initialization failed', { error });
  }
  for (const pool of await protocolRepository.getActivePools(env.ROBINHOOD_CHAIN_ID)) {
    try {
      protocolRuntime.manager.registerPool(pool);
    } catch (error) {
      logger.warn('Skipping pool owned by an inactive adapter', {
        poolAddress: pool.poolAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const riskAnalysis = createRiskAnalysisRuntime({
    database,
    chainId: env.ROBINHOOD_CHAIN_ID,
    chainClient: rpcClient,
    protocolManager: protocolRuntime.manager,
    metadataProvider,
  });
  const poolRefresh = new PoolRefreshJob(protocolRuntime.manager, protocolRepository);
  const discoveryRefresh = new DiscoveryRefreshJob(
    new DrizzleDiscoverySourceRepository(database.db, {
      minimumHealthyLiquidityRaw: BigInt(env.DISCOVERY_MIN_HEALTHY_LIQUIDITY_RAW),
      tinyTradeThresholdRaw: BigInt(env.DISCOVERY_TINY_TRADE_THRESHOLD_RAW),
      maximumRecentTrades: env.DISCOVERY_MAX_RECENT_TRADES,
    }),
    new DrizzleDiscoveryRepository(database.db),
  );
  const protocolEnrichment = new ProtocolEnrichmentJob(
    chainRegistry,
    protocolValidation,
    protocolRepository,
  );
  const alertDelivery = new AlertDeliveryService({
    database,
    logger,
    publicAppUrl: env.PUBLIC_APP_URL,
    emailFrom: `Hood Sentry <${env.SUPPORT_EMAIL}>`,
    notificationEncryptionSecret: env.SESSION_SECRET,
    email:
      env.EMAIL_PROVIDER_API_KEY === undefined
        ? undefined
        : new ResendEmailProvider(env.EMAIL_PROVIDER_API_KEY),
    telegram:
      env.TELEGRAM_BOT_TOKEN === undefined
        ? undefined
        : new TelegramBotProvider(env.TELEGRAM_BOT_TOKEN),
    push:
      env.WEB_PUSH_PUBLIC_KEY === undefined || env.WEB_PUSH_PRIVATE_KEY === undefined
        ? undefined
        : new WebPushProvider({
            publicKey: env.WEB_PUSH_PUBLIC_KEY,
            privateKey: env.WEB_PUSH_PRIVATE_KEY,
            subject: `mailto:${env.SUPPORT_EMAIL}`,
          }),
    webhook:
      env.WEBHOOK_SIGNING_SECRET === undefined
        ? undefined
        : new SignedWebhookProvider(env.WEBHOOK_SIGNING_SECRET),
  });
  const riskAlerts = new RiskAlertService(database, logger, alertDelivery);

  const runner = createDerivedJobWorker({
    connection: workerConnection,
    deadLetterConnection,
    handler: createDerivedJobRouter(logger, database, {
      poolRefresh,
      discoveryRefresh,
      riskAnalysis,
      alertDelivery,
      riskAlerts,
      chainReader: protocolClient,
      protocolEnrichment,
      oracleClient,
    }),
    onDeadLetter: (record) => {
      logger.error('Derived job dead-lettered after exhausting retries', {
        type: record.payload.type,
        originalJobId: record.originalJobId,
        attemptsMade: record.attemptsMade,
        failedReason: record.failedReason,
      });
    },
    onError: (error) => {
      logger.error('Derived job worker error', { error: error.message });
    },
  });

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutdown signal received', { signal });
    await runner.close();
    await workerConnection.quit();
    await deadLetterConnection.quit();
    await rpcClient.disconnect();
    await database.close();
    logger.info('Worker stopped gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Worker ready, consuming derived jobs');
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: fatal startup error
  console.error('Worker failed to start:', err);
  process.exit(1);
});
