import { z } from 'zod';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MAINNET_CHAIN_ID = 4663;
const TESTNET_CHAIN_ID = 46630;
const VALID_CHAIN_IDS = [MAINNET_CHAIN_ID, TESTNET_CHAIN_ID] as const;
const PUBLIC_RPC_PATTERNS = ['rpc.mainnet.chain.robinhood.com', 'rpc.testnet.chain.robinhood.com'];
const LOCAL_DB_PATTERNS = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];

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
  STATUS_PAGE_URL: z.string().url().optional(),
  LEGAL_ENTITY_NAME: z.string().default('Hood Sentry'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
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
  ROBINHOOD_RPC_PRIMARY: z.string().url(),
  ROBINHOOD_RPC_SECONDARY: z.string().url().optional(),
  ROBINHOOD_WS_PRIMARY: z.string().url().optional(),
  ROBINHOOD_WS_SECONDARY: z.string().url().optional(),
  BLOCKSCOUT_API_BASE: z.string().url().default('https://robinhoodchain.blockscout.com/api'),
  BLOCKSCOUT_WEB_BASE: z.string().url().default('https://robinhoodchain.blockscout.com'),
  RPC_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  RPC_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  INDEXER_CONFIRMATION_MODE: z.enum(['soft', 'finalized']).default('soft'),
});

const authSchema = z.object({
  SESSION_SECRET: z.string().min(1),
  SIWE_DOMAIN: z.string().min(1),
  SIWE_URI: z.string().url().default('http://localhost:3000'),
  SESSION_DURATION_SECONDS: z.coerce.number().int().positive().default(86400),
  SESSION_REAUTH_SECONDS: z.coerce.number().int().positive().default(3600),
});

const storageSchema = z.object({
  OBJECT_STORAGE_ENDPOINT: z.string().url().optional(),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().default('auto'),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
});

const notificationsSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  EMAIL_PROVIDER_API_KEY: z.string().optional(),
  WEB_PUSH_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_PRIVATE_KEY: z.string().optional(),
  WEBHOOK_SIGNING_SECRET: z.string().optional(),
});

const contractsSchema = z.object({
  SENTRY_TOKEN_ADDRESS: ethereumAddressSchema.optional(),
  ACCESS_STAKING_ADDRESS: ethereumAddressSchema.optional(),
  PROJECT_REGISTRY_ADDRESS: ethereumAddressSchema.optional(),
  PROJECT_BOND_VAULT_ADDRESS: ethereumAddressSchema.optional(),
  REPORT_REGISTRY_ADDRESS: ethereumAddressSchema.optional(),
  TIMELOCK_ADDRESS: ethereumAddressSchema.optional(),
  TREASURY_SAFE_ADDRESS: ethereumAddressSchema.optional(),
});

const booleanStringSchema = z.preprocess((val) => {
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') return false;
  }
  return val;
}, z.boolean());

const featureFlagsSchema = z.object({
  TRADING_ENABLED: booleanStringSchema.default(false),
  TOKEN_STAKING_ENABLED: booleanStringSchema.default(false),
  PROJECT_BONDS_ENABLED: booleanStringSchema.default(false),
  REPORT_BONDS_ENABLED: booleanStringSchema.default(false),
  ADMIN_SLASHING_ENABLED: booleanStringSchema.default(false),
  GAS_SPONSORSHIP_ENABLED: booleanStringSchema.default(false),
  AI_EXPLANATIONS_ENABLED: booleanStringSchema.default(false),
  WEBHOOKS_ENABLED: booleanStringSchema.default(false),
  STOCK_TOKEN_MODULE_ENABLED: booleanStringSchema.default(false),
  MAINNET_WRITES_ENABLED: booleanStringSchema.default(false),
  PROJECT_CLAIMS_ENABLED: booleanStringSchema.default(false),
  COMMUNITY_REPORTS_ENABLED: booleanStringSchema.default(false),
});

const observabilitySchema = z.object({
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('hood-sentry'),
});

const baseSchema = applicationSchema
  .merge(databaseSchema)
  .merge(chainSchema)
  .merge(authSchema)
  .merge(storageSchema)
  .merge(notificationsSchema)
  .merge(contractsSchema)
  .merge(featureFlagsSchema)
  .merge(observabilitySchema);

export const envSchema = baseSchema.superRefine((data, ctx) => {
  const isProduction = data.NODE_ENV === 'production';

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

  if (isProduction) {
    if (isLocalDatabaseUrl(data.DATABASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'Production must not use a local database URL',
      });
    }

    if (isPublicRpc(data.ROBINHOOD_RPC_PRIMARY) && !data.ROBINHOOD_RPC_SECONDARY) {
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
  'TOKEN_STAKING_ENABLED',
  'PROJECT_BONDS_ENABLED',
  'REPORT_BONDS_ENABLED',
  'AI_EXPLANATIONS_ENABLED',
  'WEBHOOKS_ENABLED',
  'STOCK_TOKEN_MODULE_ENABLED',
  'PROJECT_CLAIMS_ENABLED',
  'COMMUNITY_REPORTS_ENABLED',
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
  TOKEN_STAKING_ENABLED: boolean;
  PROJECT_BONDS_ENABLED: boolean;
  REPORT_BONDS_ENABLED: boolean;
  AI_EXPLANATIONS_ENABLED: boolean;
  WEBHOOKS_ENABLED: boolean;
  STOCK_TOKEN_MODULE_ENABLED: boolean;
  PROJECT_CLAIMS_ENABLED: boolean;
  COMMUNITY_REPORTS_ENABLED: boolean;
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
