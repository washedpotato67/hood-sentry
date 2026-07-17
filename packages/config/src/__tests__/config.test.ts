import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ZodIssue } from 'zod';
import { ConfigurationError, getEnv, isFrozen, loadEnv, resetEnvCache } from '../env.js';
import {
  MAINNET_CHAIN_ID,
  TESTNET_CHAIN_ID,
  ZERO_ADDRESS,
  envSchema,
  getConfigFingerprint,
  getPublicEnv,
  isSecretKey,
} from '../schema.js';

describe('Configuration Schema', () => {
  const validBaseConfig = {
    NODE_ENV: 'development',
    PRODUCT_NAME: 'Hood Sentry',
    PRODUCT_SHORT_NAME: 'SENTRY',
    PRODUCT_DESCRIPTION: 'Robinhood Chain Intelligence Platform',
    PRODUCT_DOMAIN: 'hoodsentry.com',
    PUBLIC_APP_URL: 'http://localhost:3000',
    SUPPORT_EMAIL: 'support@hoodsentry.com',
    LEGAL_ENTITY_NAME: 'Hood Sentry',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    DATABASE_POOL_MIN: '2',
    DATABASE_POOL_MAX: '20',
    REDIS_URL: 'redis://localhost:6379',
    QUEUE_PREFIX: 'hoodsentry',
    ROBINHOOD_CHAIN_ID: '46630',
    ROBINHOOD_RPC_PRIMARY: 'https://rpc.testnet.chain.robinhood.com',
    BLOCKSCOUT_API_BASE: 'https://robinhoodchain.blockscout.com/api',
    BLOCKSCOUT_WEB_BASE: 'https://robinhoodchain.blockscout.com',
    RPC_TIMEOUT_MS: '30000',
    RPC_MAX_RETRIES: '3',
    INDEXER_CONFIRMATION_MODE: 'soft',
    SESSION_SECRET: 'a'.repeat(64),
    SIWE_DOMAIN: 'localhost:3000',
    SIWE_URI: 'http://localhost:3000',
    SESSION_DURATION_SECONDS: '86400',
    SESSION_REAUTH_SECONDS: '3600',
    LOG_LEVEL: 'info',
    OTEL_SERVICE_NAME: 'hood-sentry',
    TRADING_ENABLED: 'false',
    TOKEN_GATE_ENABLED: 'false',
    GAS_SPONSORSHIP_ENABLED: 'false',
    AI_EXPLANATIONS_ENABLED: 'false',
    WEBHOOKS_ENABLED: 'false',
    MAINNET_WRITES_ENABLED: 'false',
    PROJECT_CLAIMS_ENABLED: 'false',
    COMMUNITY_REPORTS_ENABLED: 'false',
  };

  describe('Basic Validation', () => {
    it('should validate a complete valid configuration', () => {
      const result = envSchema.safeParse(validBaseConfig);
      expect(result.success).toBe(true);
    });

    it('should apply default values for optional fields', () => {
      const minimal = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        REDIS_URL: 'redis://localhost:6379',
        ROBINHOOD_RPC_PRIMARY: 'https://rpc.testnet.chain.robinhood.com',
        SESSION_SECRET: 'a'.repeat(64),
        SIWE_DOMAIN: 'localhost:3000',
      };

      const result = envSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('development');
        expect(result.data.PRODUCT_NAME).toBe('Hood Sentry');
        expect(result.data.DATABASE_POOL_MAX).toBe(20);
        expect(result.data.ROBINHOOD_CHAIN_ID).toBe(TESTNET_CHAIN_ID);
        expect(result.data.TRADING_ENABLED).toBe(false);
      }
    });
  });

  describe('Missing Variables', () => {
    it('requires an AI provider key when AI explanations are enabled', () => {
      const result = envSchema.safeParse({
        ...validBaseConfig,
        AI_EXPLANATIONS_ENABLED: 'true',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.includes('AI_PROVIDER_API_KEY')),
        ).toBe(true);
      }
    });

    it('should reject missing required DATABASE_URL', () => {
      const config = { ...validBaseConfig };
      // biome-ignore lint/performance/noDelete: testing missing required field
      delete (config as Record<string, unknown>).DATABASE_URL;

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('DATABASE_URL'))).toBe(
          true,
        );
      }
    });

    it('should reject missing required REDIS_URL', () => {
      const config = { ...validBaseConfig };
      // biome-ignore lint/performance/noDelete: testing missing required field
      delete (config as Record<string, unknown>).REDIS_URL;

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('REDIS_URL'))).toBe(true);
      }
    });

    it('should reject missing required SESSION_SECRET', () => {
      const config = { ...validBaseConfig };
      // biome-ignore lint/performance/noDelete: testing missing required field
      delete (config as Record<string, unknown>).SESSION_SECRET;

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('SESSION_SECRET'))).toBe(
          true,
        );
      }
    });

    it('should reject a missing RPC URL and Alchemy key', () => {
      const config = { ...validBaseConfig };
      // biome-ignore lint/performance/noDelete: testing missing required field
      delete (config as Record<string, unknown>).ROBINHOOD_RPC_PRIMARY;

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('ALCHEMY_API_KEY'))).toBe(
          true,
        );
      }
    });

    it('should accept an Alchemy key without an explicit primary RPC URL', () => {
      const config = { ...validBaseConfig, ALCHEMY_API_KEY: 'provider-key' };
      // biome-ignore lint/performance/noDelete: testing key-driven provider setup
      delete (config as Record<string, unknown>).ROBINHOOD_RPC_PRIMARY;

      const result = envSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.ROBINHOOD_RPC_PRIMARY).toBeUndefined();
    });

    it('should treat empty optional keys as unset, the way .env.example ships them', () => {
      const config = {
        ...validBaseConfig,
        STATUS_PAGE_URL: '',
        OBJECT_STORAGE_ENDPOINT: '',
        OTEL_EXPORTER_OTLP_ENDPOINT: '',
        SENTRY_TOKEN_ADDRESS: '',
        TREASURY_SAFE_ADDRESS: '',
      };

      const result = envSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.STATUS_PAGE_URL).toBeUndefined();
        expect(result.data.OBJECT_STORAGE_ENDPOINT).toBeUndefined();
        expect(result.data.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
        expect(result.data.SENTRY_TOKEN_ADDRESS).toBeUndefined();
        expect(result.data.TREASURY_SAFE_ADDRESS).toBeUndefined();
      }
    });

    it('should treat empty notification credentials as unset', () => {
      // Callers build a delivery channel whenever these are not undefined, and
      // the providers reject a blank key, so '' must not survive parsing.
      const config = {
        ...validBaseConfig,
        TELEGRAM_BOT_TOKEN: '',
        EMAIL_PROVIDER_API_KEY: '',
        WEB_PUSH_PUBLIC_KEY: '',
        WEB_PUSH_PRIVATE_KEY: '',
        WEBHOOK_SIGNING_SECRET: '',
      };

      const result = envSchema.safeParse(config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TELEGRAM_BOT_TOKEN).toBeUndefined();
        expect(result.data.EMAIL_PROVIDER_API_KEY).toBeUndefined();
        expect(result.data.WEB_PUSH_PUBLIC_KEY).toBeUndefined();
        expect(result.data.WEB_PUSH_PRIVATE_KEY).toBeUndefined();
        expect(result.data.WEBHOOK_SIGNING_SECRET).toBeUndefined();
      }
    });

    it('should still reject a malformed optional address rather than ignore it', () => {
      const result = envSchema.safeParse({ ...validBaseConfig, TREASURY_SAFE_ADDRESS: '0xnope' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i: ZodIssue) => i.path.includes('TREASURY_SAFE_ADDRESS')),
        ).toBe(true);
      }
    });
  });

  describe('URL Validation', () => {
    it('should reject malformed DATABASE_URL', () => {
      const config = { ...validBaseConfig, DATABASE_URL: 'not-a-url' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('DATABASE_URL'))).toBe(
          true,
        );
      }
    });

    it('should reject malformed PUBLIC_APP_URL', () => {
      const config = { ...validBaseConfig, PUBLIC_APP_URL: 'not-a-url' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('PUBLIC_APP_URL'))).toBe(
          true,
        );
      }
    });

    it('should reject malformed ROBINHOOD_RPC_PRIMARY', () => {
      const config = { ...validBaseConfig, ROBINHOOD_RPC_PRIMARY: 'not-a-url' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject malformed optional URLs', () => {
      const config = { ...validBaseConfig, STATUS_PAGE_URL: 'not-a-url' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('Chain ID Validation', () => {
    it('should accept mainnet chain ID (4663)', () => {
      const config = { ...validBaseConfig, ROBINHOOD_CHAIN_ID: '4663' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ROBINHOOD_CHAIN_ID).toBe(MAINNET_CHAIN_ID);
      }
    });

    it('should accept testnet chain ID (46630)', () => {
      const config = { ...validBaseConfig, ROBINHOOD_CHAIN_ID: '46630' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ROBINHOOD_CHAIN_ID).toBe(TESTNET_CHAIN_ID);
      }
    });

    it('should reject invalid chain ID', () => {
      const config = { ...validBaseConfig, ROBINHOOD_CHAIN_ID: '1' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i: ZodIssue) => i.path.includes('ROBINHOOD_CHAIN_ID')),
        ).toBe(true);
        expect(result.error.issues[0]?.message).toContain('4663');
        expect(result.error.issues[0]?.message).toContain('46630');
      }
    });

    it('should reject non-numeric chain ID', () => {
      const config = { ...validBaseConfig, ROBINHOOD_CHAIN_ID: 'not-a-number' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('Secret Validation', () => {
    it('should reject weak secrets (too short)', () => {
      const config = { ...validBaseConfig, SESSION_SECRET: 'short' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('SESSION_SECRET'))).toBe(
          true,
        );
        expect(result.error.issues[0]?.message).toContain('32 characters');
      }
    });

    it('should accept strong secrets', () => {
      const config = { ...validBaseConfig, SESSION_SECRET: 'a'.repeat(64) };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject placeholder secrets in production', () => {
      const config = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@prod-db.example.com:5432/db',
        SESSION_SECRET: 'change-me-to-a-real-secret-that-is-long-enough',
        ROBINHOOD_RPC_SECONDARY: 'https://managed-rpc.example.com',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('SESSION_SECRET'))).toBe(
          true,
        );
        expect(result.error.issues[0]?.message).toContain('placeholder');
      }
    });

    it('should allow placeholder secrets in development', () => {
      const config = {
        ...validBaseConfig,
        NODE_ENV: 'development',
        SESSION_SECRET: 'change-me-to-a-real-secret-that-is-long-enough',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate WEBHOOK_SIGNING_SECRET when provided', () => {
      const config = {
        ...validBaseConfig,
        WEBHOOK_SIGNING_SECRET: 'short',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i: ZodIssue) => i.path.includes('WEBHOOK_SIGNING_SECRET')),
        ).toBe(true);
      }
    });
  });

  describe('Ethereum Address Validation', () => {
    it('should accept valid Ethereum addresses', () => {
      const config = {
        ...validBaseConfig,
        SENTRY_TOKEN_ADDRESS: '0x1234567890123456789012345678901234567890',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject zero address', () => {
      const config = {
        ...validBaseConfig,
        SENTRY_TOKEN_ADDRESS: ZERO_ADDRESS,
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i: ZodIssue) => i.path.includes('SENTRY_TOKEN_ADDRESS')),
        ).toBe(true);
        expect(result.error.issues[0]?.message).toContain('Zero address');
      }
    });

    it('should reject invalid address format', () => {
      const config = {
        ...validBaseConfig,
        SENTRY_TOKEN_ADDRESS: 'not-an-address',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject address with wrong length', () => {
      const config = {
        ...validBaseConfig,
        SENTRY_TOKEN_ADDRESS: '0x1234',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should allow optional contract addresses to be empty', () => {
      const config = { ...validBaseConfig };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SENTRY_TOKEN_ADDRESS).toBeUndefined();
      }
    });
  });

  describe('Production Safety Checks', () => {
    it('should reject local database URL in production', () => {
      const config = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        SESSION_SECRET: 'a'.repeat(64),
        ROBINHOOD_RPC_SECONDARY: 'https://managed-rpc.example.com',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i: ZodIssue) => i.path.includes('DATABASE_URL'))).toBe(
          true,
        );
        expect(result.error.issues[0]?.message).toContain('local database');
      }
    });

    it('should reject 127.0.0.1 database URL in production', () => {
      const config = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/db',
        SESSION_SECRET: 'a'.repeat(64),
        ROBINHOOD_RPC_SECONDARY: 'https://managed-rpc.example.com',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should allow local database URL in development', () => {
      const config = {
        ...validBaseConfig,
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject public RPC as primary without secondary in production', () => {
      const config = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@prod-db.example.com:5432/db',
        ROBINHOOD_RPC_PRIMARY: 'https://rpc.mainnet.chain.robinhood.com',
        SESSION_SECRET: 'a'.repeat(64),
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i: ZodIssue) => i.path.includes('ROBINHOOD_RPC_PRIMARY')),
        ).toBe(true);
        expect(result.error.issues[0]?.message).toContain('public rate-limited');
      }
    });

    it('should allow public RPC with secondary in production', () => {
      const config = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@prod-db.example.com:5432/db',
        ROBINHOOD_RPC_PRIMARY: 'https://rpc.mainnet.chain.robinhood.com',
        ROBINHOOD_RPC_SECONDARY: 'https://managed-rpc.example.com',
        SESSION_SECRET: 'a'.repeat(64),
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should allow managed RPC as primary in production', () => {
      const config = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@prod-db.example.com:5432/db',
        ROBINHOOD_RPC_PRIMARY: 'https://managed-rpc.example.com',
        SESSION_SECRET: 'a'.repeat(64),
      };

      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('Feature Flags', () => {
    it('should coerce string "true" to boolean true', () => {
      const config = { ...validBaseConfig, TRADING_ENABLED: 'true' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TRADING_ENABLED).toBe(true);
      }
    });

    it('should coerce string "false" to boolean false', () => {
      const config = { ...validBaseConfig, TRADING_ENABLED: 'false' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TRADING_ENABLED).toBe(false);
      }
    });

    it('should coerce string "1" to boolean true', () => {
      const config = { ...validBaseConfig, TRADING_ENABLED: '1' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TRADING_ENABLED).toBe(true);
      }
    });

    it('should coerce string "0" to boolean false', () => {
      const config = { ...validBaseConfig, TRADING_ENABLED: '0' };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TRADING_ENABLED).toBe(false);
      }
    });

    it('should default all feature flags to false', () => {
      const config = { ...validBaseConfig };
      const result = envSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TRADING_ENABLED).toBe(false);
        expect(result.data.TOKEN_GATE_ENABLED).toBe(false);
        expect(result.data.GAS_SPONSORSHIP_ENABLED).toBe(false);
        expect(result.data.AI_EXPLANATIONS_ENABLED).toBe(false);
        expect(result.data.WEBHOOKS_ENABLED).toBe(false);
        expect(result.data.MAINNET_WRITES_ENABLED).toBe(false);
        expect(result.data.PROJECT_CLAIMS_ENABLED).toBe(false);
        expect(result.data.COMMUNITY_REPORTS_ENABLED).toBe(false);
      }
    });
  });

  describe('Public Environment', () => {
    it('should extract only public-safe variables', () => {
      const result = envSchema.safeParse(validBaseConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        const publicEnv = getPublicEnv(result.data);

        expect(publicEnv.NODE_ENV).toBe('development');
        expect(publicEnv.PRODUCT_NAME).toBe('Hood Sentry');
        expect(publicEnv.ROBINHOOD_CHAIN_ID).toBe(TESTNET_CHAIN_ID);
        expect(publicEnv.TRADING_ENABLED).toBe(false);

        // Server-only values should not be present
        const publicEnvRecord = publicEnv as Record<string, unknown>;
        expect(publicEnvRecord.DATABASE_URL).toBeUndefined();
        expect(publicEnvRecord.SESSION_SECRET).toBeUndefined();
        expect(publicEnvRecord.ROBINHOOD_RPC_PRIMARY).toBeUndefined();
      }
    });

    it('should identify secret keys correctly', () => {
      expect(isSecretKey('SESSION_SECRET')).toBe(true);
      expect(isSecretKey('DATABASE_URL')).toBe(true);
      expect(isSecretKey('REDIS_URL')).toBe(true);
      expect(isSecretKey('TELEGRAM_BOT_TOKEN')).toBe(true);
      expect(isSecretKey('WEBHOOK_SIGNING_SECRET')).toBe(true);
      expect(isSecretKey('ALCHEMY_API_KEY')).toBe(true);
      expect(isSecretKey('BLOCKSCOUT_API_KEY')).toBe(true);
      expect(isSecretKey('ROBINHOOD_RPC_PRIMARY')).toBe(true);

      expect(isSecretKey('NODE_ENV')).toBe(false);
      expect(isSecretKey('PRODUCT_NAME')).toBe(false);
      expect(isSecretKey('TRADING_ENABLED')).toBe(false);
    });
  });

  describe('Configuration Fingerprint', () => {
    it('should generate fingerprint without revealing secrets', () => {
      const result = envSchema.safeParse(validBaseConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        const fingerprint = getConfigFingerprint(result.data);

        expect(fingerprint.SESSION_SECRET).toBe('[set:64chars]');
        expect(fingerprint.DATABASE_URL).toMatch(/^\[set:\d+chars\]$/);
        expect(fingerprint.NODE_ENV).toBe('development');
        expect(fingerprint.PRODUCT_NAME).toBe('Hood Sentry');
      }
    });

    it('should mark unset optional secrets as [unset]', () => {
      const result = envSchema.safeParse(validBaseConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        const fingerprint = getConfigFingerprint(result.data);
        expect(fingerprint.WEBHOOK_SIGNING_SECRET).toBe('[unset]');
        expect(fingerprint.TELEGRAM_BOT_TOKEN).toBe('[unset]');
        expect(fingerprint.ALCHEMY_API_KEY).toBe('[unset]');
      }
    });
  });
});

describe('Configuration Loading', () => {
  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    resetEnvCache();
  });

  it('should load and freeze configuration', () => {
    const originalEnv = { ...process.env };

    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.ROBINHOOD_RPC_PRIMARY = 'https://rpc.testnet.chain.robinhood.com';
    process.env.SESSION_SECRET = 'a'.repeat(64);
    process.env.SIWE_DOMAIN = 'localhost:3000';

    const env = loadEnv();

    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
    expect(isFrozen()).toBe(true);

    // Restore original env
    process.env = originalEnv;
  });

  it('should throw ConfigurationError on invalid config', () => {
    const originalEnv = { ...process.env };

    // Clear required variables
    // biome-ignore lint/performance/noDelete: testing missing required fields
    delete process.env.DATABASE_URL;
    // biome-ignore lint/performance/noDelete: testing missing required fields
    delete process.env.REDIS_URL;

    expect(() => loadEnv()).toThrow(ConfigurationError);

    // Restore original env
    process.env = originalEnv;
  });

  it('should return cached config on subsequent calls', () => {
    const originalEnv = { ...process.env };

    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.ROBINHOOD_RPC_PRIMARY = 'https://rpc.testnet.chain.robinhood.com';
    process.env.SESSION_SECRET = 'a'.repeat(64);
    process.env.SIWE_DOMAIN = 'localhost:3000';

    const env1 = getEnv();
    const env2 = getEnv();

    expect(env1).toBe(env2);

    // Restore original env
    process.env = originalEnv;
  });

  it('should not leak secret values in error messages', () => {
    const originalEnv = { ...process.env };

    process.env.DATABASE_URL = 'postgresql://user:supersecretpassword@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.ROBINHOOD_RPC_PRIMARY = 'https://rpc.testnet.chain.robinhood.com';
    process.env.SESSION_SECRET = 'weak'; // Too short
    process.env.SIWE_DOMAIN = 'localhost:3000';

    try {
      loadEnv();
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const errorMessage = (error as Error).message;

      // Should mention the field but not the value
      expect(errorMessage).toContain('SESSION_SECRET');
      expect(errorMessage).toContain('32 characters');
      expect(errorMessage).not.toContain('weak');
    }

    // Restore original env
    process.env = originalEnv;
  });
});
