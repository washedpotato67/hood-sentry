import { z } from 'zod';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MAINNET_CHAIN_ID = 4663;
const TESTNET_CHAIN_ID = 46630;
const VALID_CHAIN_IDS = [MAINNET_CHAIN_ID, TESTNET_CHAIN_ID] as const;
const PUBLIC_RPC_PATTERNS = ['rpc.mainnet.chain.robinhood.com', 'rpc.testnet.chain.robinhood.com'];
const LOCAL_DB_PATTERNS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

const booleanStringSchema = z.preprocess((val) => {
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') return false;
  }
  return val;
}, z.boolean());

const optionalNonemptyStringSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);
const optionalUrlSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const SECRET_PLACEHOLDERS = [
  'change-me',
  'changeme',
  'placeholder',
  'example',
  'your-',
  'insert-',
  'xxx',
  'replace-me',
  'fill-in',
  'todo',
];

const ethereumAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 40-character hex address')
  .refine((addr) => addr.toLowerCase() !== ZERO_ADDRESS, {
    message: 'Zero address is not allowed',
  });

// An unset key and a key present-but-empty mean the same thing: not configured.
// `.env.example` ships optional keys as bare `KEY=`, so both must parse as undefined.
const optionalAddressSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  ethereumAddressSchema.optional(),
);

const chainIdSchema = z.coerce
  .number()
  .int()
  .refine((id) => VALID_CHAIN_IDS.includes(id as (typeof VALID_CHAIN_IDS)[number]), {
    message: `Chain ID must be ${MAINNET_CHAIN_ID} (mainnet) or ${TESTNET_CHAIN_ID} (testnet)`,
  });

function validateSecret(value: string, isProduction: boolean): string | null {
  if (value.length < 32) {
    return 'Secret must be at least 32 characters for sufficient entropy';
  }
  if (isProduction) {
    const lower = value.toLowerCase();
    for (const placeholder of SECRET_PLACEHOLDERS) {
      if (lower.includes(placeholder)) {
        return 'Production secrets must not contain placeholder values';
      }
    }
  }
  return null;
}

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOCAL_DB_PATTERNS.some((pattern) => parsed.hostname.includes(pattern));
  } catch {
    return false;
  }
}

function isPublicRpc(url: string): boolean {
  try {
    const parsed = new URL(url);
    return PUBLIC_RPC_PATTERNS.some((pattern) => parsed.hostname.includes(pattern));
  } catch {
    return false;
  }
}

const applicationSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PRODUCT_NAME: z.string().default('Hood Sentry'),
  PRODUCT_SHORT_NAME: z.string().default('SENTRY'),
  PRODUCT_DESCRIPTION: z.string().default('Robinhood Chain Intelligence Platform'),
  PRODUCT_DOMAIN: z.string().default('hoodsentry.com'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  SUPPORT_EMAIL: z.string().email().default('support@hoodsentry.com'),
  STATUS_PAGE_URL: optionalUrlSchema,
  LEGAL_ENTITY_NAME: z.string().default('Hood Sentry'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  SENTRY_API_INTERNAL_URL: z.string().url().default('http://localhost:4000'),
});

const databaseSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  REDIS_URL: z.string().url(),
  QUEUE_PREFIX: z.string().default('hoodsentry'),
});

const chainSchema = z.object({
  ROBINHOOD_CHAIN_ID: chainIdSchema.default(TESTNET_CHAIN_ID),
  ROBINHOOD_RPC_PRIMARY: optionalUrlSchema,
  ROBINHOOD_RPC_SECONDARY: optionalUrlSchema,
  ROBINHOOD_WS_PRIMARY: optionalUrlSchema,
  ROBINHOOD_WS_SECONDARY: optionalUrlSchema,
  BLOCKSCOUT_API_BASE: z.string().url().default('https://robinhoodchain.blockscout.com/api'),
  BLOCKSCOUT_WEB_BASE: z.string().url().default('https://robinhoodchain.blockscout.com'),
  RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  RPC_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  INDEXER_CONFIRMATION_MODE: z.enum(['soft', 'finalized']).default('soft'),
  // Where a fresh live indexer begins when it has no checkpoint. On a chain
  // millions of blocks deep, genesis is infeasible: `latest` starts near the
  // current head so recent activity is indexed immediately. A number pins an
  // explicit block; empty keeps the genesis default.
  INDEXER_START_BLOCK: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .union([z.literal('latest'), z.string().regex(/^\d+$/, 'Must be "latest" or a block number')])
      .optional(),
  ),
  // Maximum concurrent block fetches while draining a backlog. Low by default so
  // a rate-limited RPC provider is not flooded into HTTP 429s; raise it once the
  // provider has the compute-unit budget for more parallelism.
  INDEXER_MAX_CONCURRENCY: z.coerce.number().int().positive().max(100).default(3),
  // Derived jobs processed at once. Each transfer fans out into several jobs, so
  // the queue arrives much faster than a handful of workers can drain it, and the
  // work is almost entirely waiting on the database and the RPC provider rather
  // than on this process.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(200).default(4),
  // Walk the DEX factory's pair registry once to recover pools created before
  // the indexer's checkpoint. Pools are otherwise learned only from creation
  // events, so on a chain whose factory holds tens of thousands of pairs the
  // index sees only the handful created since it started watching. Off by
  // default: it is a long one-off walk against the provider and the explorer.
  POOL_BACKFILL_ENABLED: booleanStringSchema.default(false),
  // Pairs read per pass before progress is recorded.
  POOL_BACKFILL_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(25),
  // Keep the raw event log after deriving from it. The product serves derived
  // facts, and each carries its own provenance: a transaction hash, a block
  // number, a log index. Storing the raw rows as well keeps a second copy of the
  // chain to produce a small amount of output, and it is what exhausted the
  // database. Off means process in flight and store only what is served.
  // Contract-replay mode reads these rows and needs it on.
  PERSIST_RAW_LOGS: booleanStringSchema.default(true),
  // How far behind the chain head the indexer may be before readiness reports a
  // problem. There is a floor below this that no healthy indexer can beat: it
  // deliberately stays 64 blocks back for finality, drains in 10-block windows,
  // and polls once a second on a chain producing ten blocks a second. A
  // threshold near that floor reports a fault the architecture guarantees.
  API_MAX_BLOCK_LAG: z.coerce.number().int().positive().default(250),
  // Drain the indexer backlog with one eth_getLogs call per window rather than a
  // body and receipt fetch per block. Off by default because it indexes the event
  // log only: no transactions, no receipts, and so no contract-creation evidence
  // from receipts. Turn it on where keeping pace with the chain matters more.
  INDEXER_LOG_WINDOW_ENABLED: booleanStringSchema.default(false),
  // How many blocks of raw logs, transactions and receipts to keep behind the
  // indexed head. These are intermediates: the worker derives token transfers,
  // discovery rankings and risk findings from them, and those derived tables are
  // what the product serves. Zero keeps everything forever, which is the default
  // because how much history to retain is an operator's decision.
  RAW_DATA_RETENTION_BLOCKS: z.coerce.number().int().min(0).default(0),
  // How often the indexer checks for raw facts that have aged out.
  RETENTION_PRUNE_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  // Concurrent RPC calls coalesced into a single JSON-RPC batch request. The
  // free provider tier meters HTTP requests per second rather than calls, so
  // batching raises block throughput without raising the call count. Set to 1 to
  // send one request per call.
  RPC_BATCH_MAX_CALLS: z.coerce.number().int().positive().max(100).default(1),
  // How long a batch waits to collect more calls before it is sent. Longer waits
  // fill batches more fully at the cost of latency on the last call in each one.
  RPC_BATCH_WAIT_MS: z.coerce.number().int().min(0).max(1000).default(20),
  // Manipulation thresholds applied when ranking a token into the discovery
  // feeds. Both default to 0, which flags nothing: these are product policy, and
  // a guessed threshold would suppress or promote tokens on invented evidence.
  // Set them deliberately once the intended thresholds are decided.
  DISCOVERY_MIN_HEALTHY_LIQUIDITY_RAW: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[0-9]+$/)
      .default('0'),
  ),
  DISCOVERY_TINY_TRADE_THRESHOLD_RAW: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[0-9]+$/)
      .default('0'),
  ),
  // Recent trades loaded per candidate when assessing manipulation.
  DISCOVERY_MAX_RECENT_TRADES: z.coerce.number().int().positive().max(5000).default(500),
});

const providersSchema = z.object({
  PROVIDER_PROFILE: z.literal('default').default('default'),
  ALCHEMY_API_KEY: optionalNonemptyStringSchema,
  BLOCKSCOUT_API_KEY: optionalNonemptyStringSchema,
  MARKET_DATA_API_KEY: optionalNonemptyStringSchema,
  PORTFOLIO_DATA_API_KEY: optionalNonemptyStringSchema,
  SECURITY_FEED_API_KEY: optionalNonemptyStringSchema,
  AI_PROVIDER_API_KEY: optionalNonemptyStringSchema,
  AI_COMMENTARY_MODEL: z.string().trim().min(1).default('gpt-5.4-mini-2026-03-17'),
  AI_COMMENTARY_CACHE_SECONDS: z.coerce.number().int().positive().default(3_600),
  // The AI token report runs against any OpenAI-compatible Chat Completions
  // endpoint; OpenRouter by default, so the model is an OpenRouter slug.
  AI_PROVIDER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  AI_REPORT_MODEL: z.string().trim().min(1).default('openai/gpt-4o-mini'),
});

const authSchema = z.object({
  SESSION_SECRET: z.string().min(1),
  SIWE_DOMAIN: z.string().min(1),
  SIWE_URI: z.string().url().default('http://localhost:3000'),
  SESSION_DURATION_SECONDS: z.coerce.number().int().positive().default(86400),
  SESSION_REAUTH_SECONDS: z.coerce.number().int().positive().default(3600),
});

const storageSchema = z.object({
  OBJECT_STORAGE_ENDPOINT: optionalUrlSchema,
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().default('auto'),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
});

// Callers gate each delivery channel on `=== undefined`, then hand the value to
// a provider that rejects a blank key. An empty `KEY=` must therefore parse as
// undefined, or the channel is built with no credential and fails at boot.
const notificationsSchema = z.object({
  TELEGRAM_BOT_TOKEN: optionalNonemptyStringSchema,
  EMAIL_PROVIDER_API_KEY: optionalNonemptyStringSchema,
  WEB_PUSH_PUBLIC_KEY: optionalNonemptyStringSchema,
  WEB_PUSH_PRIVATE_KEY: optionalNonemptyStringSchema,
  WEBHOOK_SIGNING_SECRET: optionalNonemptyStringSchema,
});

const contractsSchema = z.object({
  SENTRY_TOKEN_ADDRESS: optionalAddressSchema,
  SENTRY_TOKEN_RUNTIME_BYTECODE_HASH: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
  ),
  SENTRY_TOKEN_VERIFICATION_SOURCE_URL: optionalUrlSchema,
  SENTRY_TOKEN_VERIFIED_AT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().datetime().optional(),
  ),
  SENTRY_SCOUT_MINIMUM_RAW: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[0-9]+$/)
      .optional(),
  ),
  SENTRY_ANALYST_MINIMUM_RAW: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[0-9]+$/)
      .optional(),
  ),
  SENTRY_SENTINEL_MINIMUM_RAW: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[0-9]+$/)
      .optional(),
  ),
  TOKEN_ENTITLEMENT_CACHE_SECONDS: z.coerce.number().int().positive().default(60),
  TOKEN_ENTITLEMENT_MINIMUM_HOLDING_SECONDS: z.coerce.number().int().nonnegative().default(86_400),
  TREASURY_SAFE_ADDRESS: optionalAddressSchema,
});

const featureFlagsSchema = z.object({
  TRADING_ENABLED: booleanStringSchema.default(false),
  TOKEN_GATE_ENABLED: booleanStringSchema.default(false),
  GAS_SPONSORSHIP_ENABLED: booleanStringSchema.default(false),
  AI_EXPLANATIONS_ENABLED: booleanStringSchema.default(false),
  WEBHOOKS_ENABLED: booleanStringSchema.default(false),
  MAINNET_WRITES_ENABLED: booleanStringSchema.default(false),
  PROJECT_CLAIMS_ENABLED: booleanStringSchema.default(false),
  COMMUNITY_REPORTS_ENABLED: booleanStringSchema.default(false),
  // Publishes the aggregate risk score and grade. Stays false until blocker 4 closes:
  // completeness measures the rules that ran, so a partial ruleset still grades a token.
  RISK_SCORES_ENABLED: booleanStringSchema.default(false),
});

const observabilitySchema = z.object({
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrlSchema,
  OTEL_SERVICE_NAME: z.string().default('hood-sentry'),
});

const baseSchema = applicationSchema
  .merge(databaseSchema)
  .merge(chainSchema)
  .merge(providersSchema)
  .merge(authSchema)
  .merge(storageSchema)
  .merge(notificationsSchema)
  .merge(contractsSchema)
  .merge(featureFlagsSchema)
  .merge(observabilitySchema);

export const envSchema = baseSchema.superRefine((data, ctx) => {
  const isProduction = data.NODE_ENV === 'production';

  if (!data.ROBINHOOD_RPC_PRIMARY && !data.ALCHEMY_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ALCHEMY_API_KEY'],
      message: 'Set ALCHEMY_API_KEY or ROBINHOOD_RPC_PRIMARY',
    });
  }

  const sessionSecretError = validateSecret(data.SESSION_SECRET, isProduction);
  if (sessionSecretError) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SESSION_SECRET'],
      message: sessionSecretError,
    });
  }

  if (data.WEBHOOK_SIGNING_SECRET) {
    const webhookError = validateSecret(data.WEBHOOK_SIGNING_SECRET, isProduction);
    if (webhookError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_SIGNING_SECRET'],
        message: webhookError,
      });
    }
  }

  if (data.TOKEN_GATE_ENABLED) {
    const required = [
      'SENTRY_TOKEN_ADDRESS',
      'SENTRY_TOKEN_RUNTIME_BYTECODE_HASH',
      'SENTRY_TOKEN_VERIFICATION_SOURCE_URL',
      'SENTRY_TOKEN_VERIFIED_AT',
      'SENTRY_SCOUT_MINIMUM_RAW',
      'SENTRY_ANALYST_MINIMUM_RAW',
      'SENTRY_SENTINEL_MINIMUM_RAW',
    ] as const;
    for (const key of required) {
      if (data[key] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when TOKEN_GATE_ENABLED is true`,
        });
      }
    }
    if (
      data.SENTRY_SCOUT_MINIMUM_RAW !== undefined &&
      data.SENTRY_ANALYST_MINIMUM_RAW !== undefined &&
      data.SENTRY_SENTINEL_MINIMUM_RAW !== undefined
    ) {
      const scout = BigInt(data.SENTRY_SCOUT_MINIMUM_RAW);
      const analyst = BigInt(data.SENTRY_ANALYST_MINIMUM_RAW);
      const sentinel = BigInt(data.SENTRY_SENTINEL_MINIMUM_RAW);
      if (scout <= 0n || analyst <= scout || sentinel <= analyst) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SENTRY_SCOUT_MINIMUM_RAW'],
          message: 'SENTRY tier thresholds must be positive and strictly increasing',
        });
      }
    }
  }

  if (data.AI_EXPLANATIONS_ENABLED && data.AI_PROVIDER_API_KEY === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AI_PROVIDER_API_KEY'],
      message: 'AI_PROVIDER_API_KEY is required when AI_EXPLANATIONS_ENABLED is true',
    });
  }

  if (isProduction) {
    if (isLocalDatabaseUrl(data.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'Production must not use a local database URL',
      });
    }

    if (
      data.ROBINHOOD_RPC_PRIMARY &&
      isPublicRpc(data.ROBINHOOD_RPC_PRIMARY) &&
      !data.ROBINHOOD_RPC_SECONDARY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ROBINHOOD_RPC_PRIMARY'],
        message:
          'Production must not use only a public rate-limited RPC as primary without a secondary provider',
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

const SECRET_KEYS = new Set([
  'SESSION_SECRET',
  'ALCHEMY_API_KEY',
  'BLOCKSCOUT_API_KEY',
  'MARKET_DATA_API_KEY',
  'PORTFOLIO_DATA_API_KEY',
  'SECURITY_FEED_API_KEY',
  'AI_PROVIDER_API_KEY',
  'ROBINHOOD_RPC_PRIMARY',
  'ROBINHOOD_RPC_SECONDARY',
  'ROBINHOOD_WS_PRIMARY',
  'ROBINHOOD_WS_SECONDARY',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'TELEGRAM_BOT_TOKEN',
  'EMAIL_PROVIDER_API_KEY',
  'WEB_PUSH_PRIVATE_KEY',
  'WEBHOOK_SIGNING_SECRET',
  'DATABASE_URL',
  'REDIS_URL',
]);

const PUBLIC_KEYS = new Set([
  'NODE_ENV',
  'PRODUCT_NAME',
  'PRODUCT_SHORT_NAME',
  'PRODUCT_DESCRIPTION',
  'PRODUCT_DOMAIN',
  'PUBLIC_APP_URL',
  'SUPPORT_EMAIL',
  'STATUS_PAGE_URL',
  'LEGAL_ENTITY_NAME',
  'ROBINHOOD_CHAIN_ID',
  'BLOCKSCOUT_WEB_BASE',
  'TRADING_ENABLED',
  'TOKEN_GATE_ENABLED',
  'AI_EXPLANATIONS_ENABLED',
  'WEBHOOKS_ENABLED',
  'PROJECT_CLAIMS_ENABLED',
  'COMMUNITY_REPORTS_ENABLED',
  'RISK_SCORES_ENABLED',
]);

export type PublicEnv = {
  NODE_ENV: Env['NODE_ENV'];
  PRODUCT_NAME: string;
  PRODUCT_SHORT_NAME: string;
  PRODUCT_DESCRIPTION: string;
  PRODUCT_DOMAIN: string;
  PUBLIC_APP_URL: string;
  SUPPORT_EMAIL: string;
  STATUS_PAGE_URL: string | undefined;
  LEGAL_ENTITY_NAME: string;
  ROBINHOOD_CHAIN_ID: number;
  BLOCKSCOUT_WEB_BASE: string;
  TRADING_ENABLED: boolean;
  TOKEN_GATE_ENABLED: boolean;
  AI_EXPLANATIONS_ENABLED: boolean;
  WEBHOOKS_ENABLED: boolean;
  PROJECT_CLAIMS_ENABLED: boolean;
  COMMUNITY_REPORTS_ENABLED: boolean;
  RISK_SCORES_ENABLED: boolean;
};

export function getPublicEnv(env: Env): PublicEnv {
  const result: Record<string, unknown> = {};
  for (const key of PUBLIC_KEYS) {
    result[key] = env[key as keyof Env];
  }
  return result as PublicEnv;
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key);
}

export function getConfigFingerprint(env: Env): Record<string, string> {
  const fingerprint: Record<string, string> = {};

  // Add all secret keys first, marking unset ones as [unset]
  for (const key of SECRET_KEYS) {
    const value = env[key as keyof Env];
    fingerprint[key] = value ? `[set:${String(value).length}chars]` : '[unset]';
  }

  // Add all non-secret values
  for (const [key, value] of Object.entries(env)) {
    if (!SECRET_KEYS.has(key)) {
      if (typeof value === 'object') {
        fingerprint[key] = JSON.stringify(value);
      } else {
        fingerprint[key] = String(value);
      }
    }
  }
  return fingerprint;
}

export { ZERO_ADDRESS, MAINNET_CHAIN_ID, TESTNET_CHAIN_ID, VALID_CHAIN_IDS };
