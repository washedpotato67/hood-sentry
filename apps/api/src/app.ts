import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  type DexAdapter,
  OracleClient,
  ProtocolValidationService,
  RPCClient,
  ResilientProtocolClient,
  createChainClient,
  createProtocolAdapterRuntime,
  getChainDefinition,
  isSupportedChainId,
  protocolRegistry,
} from '@hood-sentry/chain';
import { getEnv } from '@hood-sentry/config';
import {
  DrizzleAlertRepository,
  DrizzleAuthRepository,
  DrizzleBalanceRepository,
  DrizzleBlockRepositoryImpl,
  DrizzleContractRepositoryImpl,
  DrizzleIntelligenceRepository,
  DrizzlePricingRepository,
  DrizzleProductRepository,
  DrizzleProjectRepository,
  DrizzleProtocolRepositoryImpl,
  DrizzleProviderEvidenceRepository,
  DrizzleReportRepository,
  DrizzleRiskRepository,
  DrizzleTokenRepositoryImpl,
  createDatabase,
} from '@hood-sentry/db';
import { createLogger } from '@hood-sentry/observability';
import {
  BlockscoutHoldersClient,
  MarketDataAggregator,
  OpenAiRiskCommentaryProvider,
  ResendEmailProvider,
  TelegramBotProvider,
  WebPushProvider,
  resolveRpcProviders,
} from '@hood-sentry/providers';
import { RedisCache, createQueueConnection } from '@hood-sentry/queue';
import { generateRequestId } from '@hood-sentry/shared';
import Fastify from 'fastify';
import { erc20Abi, getAddress, isHash } from 'viem';
import { AggregatorDiscoveryRepository } from './aggregator-discovery.js';
import { installApiKeyHooks } from './api-key-hooks.js';
import { ApiKeyService } from './api-key-service.js';
import { AuthSessionManager } from './auth-session.js';
import { type HealthProbes, createHealthProbes } from './health-probes.js';
import { errorHandler } from './plugins/error-handler.js';
import { RiskCommentaryService } from './risk-commentary-service.js';
import { adminRoutes } from './routes/admin.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { authRoutes } from './routes/auth.js';
import { chainStatusRoutes } from './routes/chain-status.js';
import { discoveryRoutes } from './routes/discovery.js';
import { healthRoutes } from './routes/health.js';
import { intelligenceRoutes } from './routes/intelligence.js';
import { pricingRoutes } from './routes/pricing.js';
import { productRoutes } from './routes/product.js';
import { protocolRoutes } from './routes/protocols.js';
import { riskCommentaryRoutes } from './routes/risk-commentary.js';
import { tokenEntitlementRoutes } from './routes/token-entitlements.js';
import { tokenSearchRoutes } from './routes/token-search.js';
import { tokenSignalRoutes } from './routes/token-signals.js';
import { tradingRoutes } from './routes/trading.js';
import {
  TokenEntitlementService,
  type TokenGateRuntimeConfig,
} from './token-entitlement-service.js';
import { type TradingRuntime, TradingService } from './trading-service.js';

export async function buildApp(options: { healthProbes?: HealthProbes } = {}) {
  const env = getEnv();
  const logger = createLogger({ level: env.LOG_LEVEL as 'info', service: 'api' });
  const database = createDatabase(env.DATABASE_URL, { maxConnections: env.DATABASE_POOL_MAX });
  const protocolRepository = new DrizzleProtocolRepositoryImpl(database.db);
  const pricingRepository = new DrizzlePricingRepository(database.db);
  // Discovery is served from a market-data aggregator, not an indexed table, so
  // the feed reflects the chain live without the product storing it.
  const marketData = MarketDataAggregator.withDefaults();
  const holdersClient = new BlockscoutHoldersClient(env.ROBINHOOD_CHAIN_ID);
  const readCache = new RedisCache(createQueueConnection(env.REDIS_URL));
  const discoveryRepository = new AggregatorDiscoveryRepository(marketData, readCache, {
    holders: holdersClient,
  });
  const blockRepository = new DrizzleBlockRepositoryImpl(database.db);
  const authRepository = new DrizzleAuthRepository(database.db);
  const tokenRepository = new DrizzleTokenRepositoryImpl(database.db);
  const contractRepository = new DrizzleContractRepositoryImpl(database.db);
  const balanceRepository = new DrizzleBalanceRepository(database.db);
  const riskRepository = new DrizzleRiskRepository(database.db);
  const intelligenceRepository = new DrizzleIntelligenceRepository(database.db);
  const alertRepository = new DrizzleAlertRepository(database.db);
  const productRepository = new DrizzleProductRepository(database.db);
  const projectRepository = new DrizzleProjectRepository(database.db);
  const reportRepository = new DrizzleReportRepository(database.db);
  const providerEvidenceRepository = new DrizzleProviderEvidenceRepository(database.db);
  const rpcProviders = resolveRpcProviders({
    chainId: env.ROBINHOOD_CHAIN_ID,
    alchemyApiKey: env.ALCHEMY_API_KEY,
    primaryRpcUrl: env.ROBINHOOD_RPC_PRIMARY,
    secondaryRpcUrl: env.ROBINHOOD_RPC_SECONDARY,
    primaryWebsocketUrl: env.ROBINHOOD_WS_PRIMARY,
    secondaryWebsocketUrl: env.ROBINHOOD_WS_SECONDARY,
  });
  if (!isSupportedChainId(env.ROBINHOOD_CHAIN_ID)) {
    throw new Error(`Unsupported configured chain ID: ${env.ROBINHOOD_CHAIN_ID}`);
  }
  const chainClient = createChainClient({
    chainId: env.ROBINHOOD_CHAIN_ID,
    managedRpcUrl: rpcProviders.primary.url,
    secondaryRpcUrl: rpcProviders.secondary?.url,
    preferManaged: true,
  });
  const chainDefinition = getChainDefinition(env.ROBINHOOD_CHAIN_ID);
  const healthRpcClient = new RPCClient(chainDefinition, {
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
    rpcClient: healthRpcClient,
    chainId: env.ROBINHOOD_CHAIN_ID,
  });
  const commentaryProvider =
    env.AI_PROVIDER_API_KEY === undefined
      ? null
      : new OpenAiRiskCommentaryProvider(env.AI_PROVIDER_API_KEY, env.AI_COMMENTARY_MODEL);

  const app = Fastify({
    logger: false,
    genReqId: () => generateRequestId(),
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
  });

  await app.register(cors, {
    origin: env.PUBLIC_APP_URL,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  });

  app.setErrorHandler(errorHandler(logger));

  const apiKeyService = new ApiKeyService(database, env.SESSION_SECRET);
  installApiKeyHooks(app, apiKeyService);

  let tokenGateConfig: TokenGateRuntimeConfig = {
    enabled: false,
    chainId: env.ROBINHOOD_CHAIN_ID,
    version: 'sentry-entitlement-v1',
  };
  if (env.TOKEN_GATE_ENABLED) {
    if (
      env.SENTRY_TOKEN_ADDRESS === undefined ||
      env.SENTRY_TOKEN_RUNTIME_BYTECODE_HASH === undefined ||
      env.SENTRY_TOKEN_VERIFICATION_SOURCE_URL === undefined ||
      env.SENTRY_TOKEN_VERIFIED_AT === undefined ||
      env.SENTRY_SCOUT_MINIMUM_RAW === undefined ||
      env.SENTRY_ANALYST_MINIMUM_RAW === undefined ||
      env.SENTRY_SENTINEL_MINIMUM_RAW === undefined ||
      !isHash(env.SENTRY_TOKEN_RUNTIME_BYTECODE_HASH)
    ) {
      throw new Error('TOKEN_GATE_VERIFICATION_CONFIG_INCOMPLETE');
    }
    tokenGateConfig = {
      enabled: true,
      chainId: env.ROBINHOOD_CHAIN_ID,
      tokenAddress: getAddress(env.SENTRY_TOKEN_ADDRESS),
      runtimeBytecodeHash: env.SENTRY_TOKEN_RUNTIME_BYTECODE_HASH,
      verificationSourceUrl: env.SENTRY_TOKEN_VERIFICATION_SOURCE_URL,
      verifiedAt: env.SENTRY_TOKEN_VERIFIED_AT,
      minimums: {
        free: 0n,
        scout: BigInt(env.SENTRY_SCOUT_MINIMUM_RAW),
        analyst: BigInt(env.SENTRY_ANALYST_MINIMUM_RAW),
        sentinel: BigInt(env.SENTRY_SENTINEL_MINIMUM_RAW),
      },
      cacheSeconds: env.TOKEN_ENTITLEMENT_CACHE_SECONDS,
      minimumHoldingSeconds: env.TOKEN_ENTITLEMENT_MINIMUM_HOLDING_SECONDS,
      version: 'sentry-entitlement-v1',
    };
  }
  const tokenEntitlements = new TokenEntitlementService(
    database,
    {
      getChainId: () => chainClient.getChainId(),
      getBytecode: (address, blockNumber) => chainClient.getBytecode({ address, blockNumber }),
      async balanceOf(tokenAddress, walletAddress, blockNumber) {
        const result = await chainClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [walletAddress],
          blockNumber,
        });
        if (typeof result !== 'bigint') throw new Error('SENTRY_BALANCE_RESPONSE_INVALID');
        return result;
      },
    },
    tokenGateConfig,
  );
  let tradingRuntime: TradingRuntime | null = null;
  if (env.TRADING_ENABLED) {
    const rpcClient = new RPCClient(chainDefinition, {
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
    const chainRegistry = {
      ...protocolRegistry,
      protocols: protocolRegistry.protocols.filter(
        (definition) => definition.chainId === env.ROBINHOOD_CHAIN_ID,
      ),
    };
    const protocolClient = new ResilientProtocolClient(rpcClient);
    const validation = new ProtocolValidationService(chainRegistry, protocolClient, {
      onAlert: (alert) => logger.error('Trading protocol disabled', { ...alert }),
    });
    const runtime = await createProtocolAdapterRuntime({
      registry: chainRegistry,
      chainId: env.ROBINHOOD_CHAIN_ID,
      client: protocolClient,
      validation,
      featurePolicy: {
        async assertTradingEnabled(chainId) {
          if (!env.TRADING_ENABLED) throw new Error('TRADING_ENABLED is disabled');
          if (chainId === 4663 && !env.MAINNET_WRITES_ENABLED) {
            throw new Error('MAINNET_WRITES_ENABLED is disabled');
          }
        },
      },
    });
    for (const result of runtime.validationResults) {
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
    for (const error of runtime.initializationErrors) {
      logger.error('Trading adapter initialization failed', { error });
    }
    for (const pool of await protocolRepository.getActivePools(env.ROBINHOOD_CHAIN_ID)) {
      try {
        runtime.manager.registerPool(pool);
      } catch (error) {
        logger.warn('Trading pool skipped because its adapter is inactive', {
          poolAddress: pool.poolAddress,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const activeProtocols = new Set(
      runtime.validationResults
        .filter((result) => result.active)
        .map((result) => `${result.chainId}:${result.protocolKey}:${result.protocolVersion}`),
    );
    const allowedSpenders = new Set(
      chainRegistry.protocols
        .filter((definition) =>
          activeProtocols.has(
            `${definition.chainId}:${definition.protocolKey}:${definition.protocolVersion}`,
          ),
        )
        .flatMap((definition) =>
          definition.contracts
            .filter((contract) => contract.enabled && contract.contractRole === 'router')
            .map((contract) => contract.address.toLowerCase()),
        ),
    );
    tradingRuntime = {
      adapters: runtime.manager
        .getActiveAdapters()
        .filter((adapter): adapter is DexAdapter => adapter.kind === 'dex'),
      client: protocolClient,
      allowedSpenders,
    };
  }
  const trading = new TradingService(
    database,
    protocolRepository,
    tradingRuntime,
    {
      chainId: env.ROBINHOOD_CHAIN_ID,
      enabled: env.TRADING_ENABLED,
      mainnetWritesEnabled: env.MAINNET_WRITES_ENABLED,
      configurationVersion: protocolRegistry.version,
      quoteTtlSeconds: 30,
    },
    () => new Date(),
    {
      async getTransaction(hash) {
        const transaction = await chainClient.getTransaction({ hash });
        return {
          from: transaction.from,
          to: transaction.to,
          input: transaction.input,
          value: transaction.value,
        };
      },
      async getTransactionReceipt(hash) {
        const receipt = await chainClient.getTransactionReceipt({ hash });
        return {
          transactionHash: receipt.transactionHash,
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
        };
      },
    },
  );

  app.decorateRequest('appLogger', null);

  app.addHook('onRequest', async (request) => {
    const requestId = request.id;
    (request as unknown as { appLogger: ReturnType<typeof createLogger> }).appLogger = logger.child(
      {
        requestId,
        bindings: {
          method: request.method,
          url: request.url,
        },
      },
    );
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(healthRoutes, {
    prefix: '/health',
    probes:
      options.healthProbes ??
      createHealthProbes({
        database,
        redisUrl: env.REDIS_URL,
        rpcUrl: rpcProviders.primary.url,
        rpcProviderId: rpcProviders.primary.providerId,
        chainId: env.ROBINHOOD_CHAIN_ID,
        rpcTimeoutMs: env.RPC_TIMEOUT_MS,
        maximumBlockLag: BigInt(env.API_MAX_BLOCK_LAG),
        blockscoutApiBaseUrl: env.BLOCKSCOUT_API_BASE,
        blockscoutApiKey: env.BLOCKSCOUT_API_KEY,
        oracleClient,
        optionalProviderConfiguration: [
          {
            providerId: 'market-data',
            capability: 'marketData',
            configured: env.MARKET_DATA_API_KEY !== undefined,
          },
          {
            providerId: 'portfolio-data',
            capability: 'portfolioData',
            configured: env.PORTFOLIO_DATA_API_KEY !== undefined,
          },
          {
            providerId: 'security-feed',
            capability: 'securityLabels',
            configured: env.SECURITY_FEED_API_KEY !== undefined,
          },
          {
            providerId: 'openai',
            capability: 'aiCommentary',
            configured: env.AI_PROVIDER_API_KEY !== undefined,
            probe:
              commentaryProvider === null
                ? undefined
                : async () => {
                    const startedAt = Date.now();
                    try {
                      await commentaryProvider.checkAvailability();
                      return { status: 'ok' as const, latencyMs: Date.now() - startedAt };
                    } catch {
                      return {
                        status: 'error' as const,
                        latencyMs: Date.now() - startedAt,
                        code: 'OPENAI_UNAVAILABLE',
                      };
                    }
                  },
          },
        ],
      }),
  });
  await app.register(protocolRoutes, {
    prefix: '/v1',
    repository: protocolRepository,
  });
  await app.register(authRoutes, {
    prefix: '/v1',
    repository: authRepository,
    verifier: async (input) =>
      chainClient.verifySiweMessage({
        address: input.address,
        domain: input.domain,
        nonce: input.nonce,
        message: input.message,
        signature: input.signature,
        time: input.time,
      }),
    chainId: env.ROBINHOOD_CHAIN_ID,
    domain: env.SIWE_DOMAIN,
    uri: env.SIWE_URI,
    publicAppUrl: env.PUBLIC_APP_URL,
    sessionSecret: env.SESSION_SECRET,
    sessionDurationSeconds: env.SESSION_DURATION_SECONDS,
    production: env.NODE_ENV === 'production',
  });
  await app.register(intelligenceRoutes, {
    prefix: '/v1',
    defaultChainId: env.ROBINHOOD_CHAIN_ID,
    tokens: tokenRepository,
    contracts: contractRepository,
    balances: balanceRepository,
    protocols: protocolRepository,
    risk: riskRepository,
    intelligence: intelligenceRepository,
    nativeBalance: (address) => chainClient.getBalance({ address }),
    riskScoresEnabled: env.RISK_SCORES_ENABLED,
    market: marketData,
    holders: holdersClient,
    readCache,
  });
  await app.register(riskCommentaryRoutes, {
    prefix: '/v1',
    sessions: new AuthSessionManager(
      authRepository,
      env.SESSION_SECRET,
      env.NODE_ENV === 'production',
    ),
    service: new RiskCommentaryService(
      riskRepository,
      providerEvidenceRepository,
      commentaryProvider,
      {
        enabled: env.AI_EXPLANATIONS_ENABLED,
        model: env.AI_COMMENTARY_MODEL,
        cacheSeconds: env.AI_COMMENTARY_CACHE_SECONDS,
      },
    ),
    publicAppUrl: env.PUBLIC_APP_URL,
    defaultChainId: env.ROBINHOOD_CHAIN_ID,
  });
  await app.register(productRoutes, {
    prefix: '/v1',
    sessions: new AuthSessionManager(
      authRepository,
      env.SESSION_SECRET,
      env.NODE_ENV === 'production',
    ),
    publicAppUrl: env.PUBLIC_APP_URL,
    sessionSecret: env.SESSION_SECRET,
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET,
    emailFrom: `Hood Sentry <${env.SUPPORT_EMAIL}>`,
    emailDelivery:
      env.EMAIL_PROVIDER_API_KEY === undefined
        ? undefined
        : new ResendEmailProvider(env.EMAIL_PROVIDER_API_KEY),
    telegramDelivery:
      env.TELEGRAM_BOT_TOKEN === undefined
        ? undefined
        : new TelegramBotProvider(env.TELEGRAM_BOT_TOKEN),
    pushDelivery:
      env.WEB_PUSH_PUBLIC_KEY === undefined || env.WEB_PUSH_PRIVATE_KEY === undefined
        ? undefined
        : new WebPushProvider({
            publicKey: env.WEB_PUSH_PUBLIC_KEY,
            privateKey: env.WEB_PUSH_PRIVATE_KEY,
            subject: `mailto:${env.SUPPORT_EMAIL}`,
          }),
    webPushPublicKey: env.WEB_PUSH_PUBLIC_KEY,
    defaultChainId: env.ROBINHOOD_CHAIN_ID,
    product: productRepository,
    alerts: alertRepository,
    projects: projectRepository,
    reports: reportRepository,
    contracts: contractRepository,
    verifySignature: (input) => chainClient.verifyMessage(input),
    projectClaimsEnabled: env.PROJECT_CLAIMS_ENABLED,
    communityReportsEnabled: env.COMMUNITY_REPORTS_ENABLED,
    webhooksEnabled: env.WEBHOOKS_ENABLED,
  });
  await app.register(adminRoutes, {
    prefix: '/v1',
    database,
    sessions: new AuthSessionManager(
      authRepository,
      env.SESSION_SECRET,
      env.NODE_ENV === 'production',
    ),
    publicAppUrl: env.PUBLIC_APP_URL,
  });
  await app.register(apiKeyRoutes, {
    prefix: '/v1',
    sessions: new AuthSessionManager(
      authRepository,
      env.SESSION_SECRET,
      env.NODE_ENV === 'production',
    ),
    service: apiKeyService,
    publicAppUrl: env.PUBLIC_APP_URL,
  });
  await app.register(tokenEntitlementRoutes, {
    prefix: '/v1',
    sessions: new AuthSessionManager(
      authRepository,
      env.SESSION_SECRET,
      env.NODE_ENV === 'production',
    ),
    service: tokenEntitlements,
    publicAppUrl: env.PUBLIC_APP_URL,
    chainId: env.ROBINHOOD_CHAIN_ID,
  });
  await app.register(tradingRoutes, {
    prefix: '/v1',
    sessions: new AuthSessionManager(
      authRepository,
      env.SESSION_SECRET,
      env.NODE_ENV === 'production',
    ),
    service: trading,
    publicAppUrl: env.PUBLIC_APP_URL,
    chainId: env.ROBINHOOD_CHAIN_ID,
  });
  await app.register(pricingRoutes, {
    prefix: '/v1',
    repository: pricingRepository,
    market: marketData,
    readCache,
  });
  await app.register(discoveryRoutes, {
    prefix: '/v1',
    repository: discoveryRepository,
    riskScoresEnabled: env.RISK_SCORES_ENABLED,
  });
  await app.register(tokenSearchRoutes, {
    prefix: '/v1',
    market: marketData,
    cache: readCache,
  });
  await app.register(chainStatusRoutes, {
    prefix: '/v1',
    repository: blockRepository,
  });
  await app.register(tokenSignalRoutes, {
    prefix: '/v1',
    risk: riskRepository,
    protocol: protocolRepository,
  });

  app.addHook('onClose', async () => {
    await healthRpcClient.disconnect();
    await database.close();
  });

  return app;
}
