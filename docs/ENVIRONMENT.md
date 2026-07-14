# Environment Configuration

This document describes all environment variables used by Hood Sentry, their validation rules, and security considerations.

## Overview

Hood Sentry uses a comprehensive configuration system with strict validation to ensure security and correctness. All environment variables are validated at startup using Zod schemas.

**Key Security Features:**
- Server-only values never enter client bundles
- Secrets are validated for entropy and placeholder values
- Production environments reject local database URLs
- Production environments require managed RPC providers (not public rate-limited endpoints)
- All secrets are redacted from logs
- Configuration is immutable after startup

## Application

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `NODE_ENV` | `development \| test \| staging \| production` | `development` | Environment mode |
| `PRODUCT_NAME` | string | `Hood Sentry` | Full product name |
| `PRODUCT_SHORT_NAME` | string | `SENTRY` | Short product identifier |
| `PRODUCT_DESCRIPTION` | string | `Robinhood Chain Intelligence Platform` | Product description |
| `PRODUCT_DOMAIN` | string | `hoodsentry.com` | Primary domain |
| `PUBLIC_APP_URL` | URL | `http://localhost:3000` | Public-facing application URL |
| `SUPPORT_EMAIL` | email | `support@hoodsentry.com` | Support contact email |
| `STATUS_PAGE_URL` | URL | (optional) | External status page URL |
| `LEGAL_ENTITY_NAME` | string | `Hood Sentry` | Legal entity name |

**Validation:** URLs must be valid. Emails must be valid format.

## Database & Queue

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | URL | (required) | PostgreSQL connection string |
| `DATABASE_POOL_MIN` | integer | `2` | Minimum database pool connections |
| `DATABASE_POOL_MAX` | integer | `20` | Maximum database pool connections |
| `REDIS_URL` | URL | (required) | Redis connection string |
| `QUEUE_PREFIX` | string | `hoodsentry` | Prefix for BullMQ queue names |

**Validation:** 
- URLs must be valid
- Pool sizes must be positive integers
- **Production:** `DATABASE_URL` must not contain `localhost`, `127.0.0.1`, `0.0.0.0`, or `::1`

**Security:** `DATABASE_URL` and `REDIS_URL` are redacted from logs.

## Robinhood Chain

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `ROBINHOOD_CHAIN_ID` | integer | `46630` | Chain ID (4663 for mainnet, 46630 for testnet) |
| `ROBINHOOD_RPC_PRIMARY` | URL | (required) | Primary RPC endpoint |
| `ROBINHOOD_RPC_SECONDARY` | URL | (optional) | Secondary RPC endpoint for failover |
| `ROBINHOOD_WS_PRIMARY` | URL | (optional) | Primary WebSocket endpoint |
| `ROBINHOOD_WS_SECONDARY` | URL | (optional) | Secondary WebSocket endpoint |
| `BLOCKSCOUT_API_BASE` | URL | `https://robinhoodchain.blockscout.com/api` | Blockscout API base URL |
| `BLOCKSCOUT_WEB_BASE` | URL | `https://robinhoodchain.blockscout.com` | Blockscout web interface URL |
| `RPC_TIMEOUT_MS` | integer | `30000` | RPC request timeout in milliseconds |
| `RPC_MAX_RETRIES` | integer | `3` | Maximum RPC retry attempts |
| `INDEXER_CONFIRMATION_MODE` | `soft \| finalized` | `soft` | Block confirmation mode for indexer |

**Validation:**
- Chain ID must be exactly `4663` (mainnet) or `46630` (testnet)
- All URLs must be valid
- **Production:** If `ROBINHOOD_RPC_PRIMARY` is a public rate-limited endpoint (e.g., `rpc.mainnet.chain.robinhood.com`), then `ROBINHOOD_RPC_SECONDARY` must be set to a managed provider

**Recommendation:** Use managed RPC providers (Alchemy, QuickNode, Infura) in production for reliability and rate limits.

## Authentication

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SESSION_SECRET` | string | (required) | Secret key for session encryption |
| `SIWE_DOMAIN` | string | (required) | Domain for Sign-In with Ethereum |
| `SIWE_URI` | URL | `http://localhost:3000` | URI for SIWE messages |
| `SESSION_DURATION_SECONDS` | integer | `86400` | Session duration (24 hours) |
| `SESSION_REAUTH_SECONDS` | integer | `3600` | Re-authentication interval (1 hour) |

**Validation:**
- `SESSION_SECRET` must be at least 32 characters
- **Production:** `SESSION_SECRET` must not contain placeholder values like `change-me`, `placeholder`, `example`, `test`, `dev`, `local`, `xxx`, `your-`, `insert-`

**Security:** `SESSION_SECRET` is redacted from logs.

**Generation:**
```bash
openssl rand -base64 48
```

## Object Storage

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OBJECT_STORAGE_ENDPOINT` | URL | (optional) | S3-compatible endpoint URL |
| `OBJECT_STORAGE_BUCKET` | string | (optional) | Bucket name |
| `OBJECT_STORAGE_REGION` | string | `auto` | Storage region |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | string | (optional) | Access key ID |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | string | (optional) | Secret access key |

**Validation:** URLs must be valid.

**Security:** `OBJECT_STORAGE_ACCESS_KEY_ID` and `OBJECT_STORAGE_SECRET_ACCESS_KEY` are redacted from logs.

## Notifications

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | string | (optional) | Telegram bot authentication token |
| `EMAIL_PROVIDER_API_KEY` | string | (optional) | Email service API key |
| `WEB_PUSH_PUBLIC_KEY` | string | (optional) | Web push VAPID public key |
| `WEB_PUSH_PRIVATE_KEY` | string | (optional) | Web push VAPID private key |
| `WEBHOOK_SIGNING_SECRET` | string | (optional) | Secret for webhook signature verification |

**Validation:**
- `WEBHOOK_SIGNING_SECRET` must be at least 32 characters if provided
- **Production:** `WEBHOOK_SIGNING_SECRET` must not contain placeholder values

**Security:** All notification secrets are redacted from logs.

**Generation:**
```bash
# Telegram: Create bot via @BotFather
# Web Push VAPID keys:
npx web-push generate-vapid-keys
# Webhook signing secret:
openssl rand -hex 32
```

## Smart Contracts

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SENTRY_TOKEN_ADDRESS` | address | (optional) | Verified launchpad-created `$SENTRY` address |
| `TREASURY_SAFE_ADDRESS` | address | (optional) | Treasury Safe (multisig) address |

**Validation:**
- Must be valid 40-character hex addresses (0x-prefixed)
- Must not be the zero address (`0x0000000000000000000000000000000000000000`)
- Checksum validation is recommended but not enforced

**Note:** Leave these empty if contracts are not yet deployed.

## Feature Flags

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `TRADING_ENABLED` | boolean | `false` | Enable trading functionality |
| `TOKEN_GATE_ENABLED` | boolean | `false` | Enable holding-based token entitlements |
| `GAS_SPONSORSHIP_ENABLED` | boolean | `false` | Enable gas sponsorship |
| `AI_EXPLANATIONS_ENABLED` | boolean | `false` | Enable AI-powered explanations |
| `WEBHOOKS_ENABLED` | boolean | `false` | Enable webhook notifications |
| `STOCK_TOKEN_MODULE_ENABLED` | boolean | `false` | Enable stock token features |
| `MAINNET_WRITES_ENABLED` | boolean | `false` | Enable mainnet write operations |
| `PROJECT_CLAIMS_ENABLED` | boolean | `false` | Enable project claims |
| `COMMUNITY_REPORTS_ENABLED` | boolean | `false` | Enable community reports |

**Validation:** Values are coerced to boolean (`true`, `false`, `1`, `0`, `yes`, `no`).

**Security:** All feature flags default to `false` for safety. Enable features explicitly after testing.

## Observability

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LOG_LEVEL` | `trace \| debug \| info \| warn \| error \| fatal` | `info` | Logging verbosity |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | URL | (optional) | OpenTelemetry collector endpoint |
| `OTEL_SERVICE_NAME` | string | `hood-sentry` | Service name for tracing |

**Validation:** URLs must be valid.

## Public vs Server-Only Configuration

The following variables are safe to expose to client-side code:

**Public (safe for client bundles):**
- `NODE_ENV`
- `PRODUCT_NAME`, `PRODUCT_SHORT_NAME`, `PRODUCT_DESCRIPTION`
- `PRODUCT_DOMAIN`, `PUBLIC_APP_URL`
- `SUPPORT_EMAIL`, `STATUS_PAGE_URL`, `LEGAL_ENTITY_NAME`
- `ROBINHOOD_CHAIN_ID`, `BLOCKSCOUT_WEB_BASE`
- All feature flags (`*_ENABLED`)

**Server-Only (never expose to client):**
- `DATABASE_URL`, `REDIS_URL`
- `SESSION_SECRET`
- `ROBINHOOD_RPC_PRIMARY`, `ROBINHOOD_RPC_SECONDARY`
- `ROBINHOOD_WS_PRIMARY`, `ROBINHOOD_WS_SECONDARY`
- `OBJECT_STORAGE_*`
- `TELEGRAM_BOT_TOKEN`, `EMAIL_PROVIDER_API_KEY`
- `WEB_PUSH_PRIVATE_KEY`, `WEBHOOK_SIGNING_SECRET`
- All contract addresses (optional but recommended to keep server-side)

Use `getPublicEnv()` from `@hood-sentry/config` to safely extract public configuration for client-side use.

## Production Safety Checks

The configuration system enforces additional safety checks in production mode:

1. **Local Database Rejection:** `DATABASE_URL` must not point to localhost or loopback addresses
2. **Public RPC Rejection:** If using a public rate-limited RPC as primary, a secondary managed provider must be configured
3. **Secret Validation:** All secrets must be at least 32 characters and must not contain placeholder values
4. **Zero Address Rejection:** Contract addresses must not be the zero address

## Configuration Fingerprint

For debugging purposes, you can generate a configuration fingerprint that shows which variables are set without revealing secret values:

```typescript
import { getFingerprint } from '@hood-sentry/config';

const fingerprint = getFingerprint();
console.log(fingerprint);
// Output: { SESSION_SECRET: '[set:64chars]', DATABASE_URL: '[set:45chars]', ... }
```

## Immutability

Configuration is frozen after initial load. Attempting to modify configuration values will not affect the running application. This prevents accidental mutations and ensures consistency.

## Error Handling

Configuration validation errors are reported with clear messages that identify the problematic variable without revealing its value:

```
[config] Invalid environment configuration:
  - SESSION_SECRET: Secret must be at least 32 characters for sufficient entropy
  - DATABASE_URL: Production must not use a local database URL
```

## Migration from Previous Schema

If you're migrating from the previous configuration schema, note these changes:

| Old Variable | New Variable | Notes |
|--------------|--------------|-------|
| `ROBINHOOD_MAINNET_RPC_URL` | `ROBINHOOD_RPC_PRIMARY` | Now chain-agnostic |
| `ROBINHOOD_TESTNET_RPC_URL` | (removed) | Use `ROBINHOOD_CHAIN_ID` to select network |
| `ROBINHOOD_MAINNET_WS_URL` | `ROBINHOOD_WS_PRIMARY` | Now chain-agnostic |
| `ROBINHOOD_TESTNET_WS_URL` | (removed) | Use `ROBINHOOD_CHAIN_ID` to select network |
| `ROBINHOOD_SECONDARY_RPC_URL` | `ROBINHOOD_RPC_SECONDARY` | Renamed for clarity |
| `BLOCKSCOUT_API_URL` | `BLOCKSCOUT_API_BASE` | Renamed for clarity |
| `SIWE_ORIGIN` | `SIWE_URI` | Renamed to match EIP-4361 spec |
| `SESSION_MAX_AGE_SECONDS` | `SESSION_DURATION_SECONDS` | Renamed for clarity |
| `S3_*` | `OBJECT_STORAGE_*` | Renamed for provider-agnostic naming |
| `TELEGRAM_WEBHOOK_SECRET` | (removed) | Use `WEBHOOK_SIGNING_SECRET` instead |
| `SMTP_*` | (removed) | Use `EMAIL_PROVIDER_API_KEY` instead |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` | (removed) | Configure in application code |
| `ADMIN_PASSKEY_RP_ID` | (removed) | Configure in application code |

**New Variables:**
- `PRODUCT_NAME`, `PRODUCT_SHORT_NAME`, `PRODUCT_DESCRIPTION`
- `PRODUCT_DOMAIN`, `LEGAL_ENTITY_NAME`
- `DATABASE_POOL_MIN`, `QUEUE_PREFIX`
- `ROBINHOOD_CHAIN_ID` (replaces separate mainnet/testnet URLs)
- `RPC_TIMEOUT_MS`, `RPC_MAX_RETRIES`
- `INDEXER_CONFIRMATION_MODE`
- `SIWE_URI`, `SESSION_REAUTH_SECONDS`
- `OBJECT_STORAGE_*` (replaces `S3_*`)
- `EMAIL_PROVIDER_API_KEY` (replaces `SMTP_*`)
- `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY`
- `WEBHOOK_SIGNING_SECRET`
- `PROJECT_CLAIMS_ENABLED`, `COMMUNITY_REPORTS_ENABLED`

## Best Practices

1. **Use a secrets manager** in production (AWS Secrets Manager, HashiCorp Vault, etc.)
2. **Rotate secrets regularly**, especially `SESSION_SECRET` and `WEBHOOK_SIGNING_SECRET`
3. **Use different credentials** for each environment (dev, staging, production)
4. **Never commit `.env` files** to version control
5. **Use managed RPC providers** in production for reliability
6. **Enable feature flags gradually** after testing in staging
7. **Monitor configuration changes** in production deployments
8. **Document any custom configuration** in your deployment runbooks

## Support

For questions or issues with configuration, contact: support@hoodsentry.com
