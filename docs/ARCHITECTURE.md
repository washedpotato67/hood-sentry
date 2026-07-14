# System Architecture

## Architectural principles

- The chain is the source of truth for onchain facts.
- PostgreSQL is the source of truth for indexed and derived application state.
- Redis is ephemeral coordination, never durable truth.
- Raw facts and derived analytics are separate.
- All workers are idempotent.
- All risk output is versioned and explainable.
- Write paths are small, simulated, and isolated.
- A provider outage must not corrupt state.
- Contracts hold only the minimum state that must be trustlessly enforceable.

## Logical topology

```text
Browser / Wallet
      |
Cloudflare DNS + WAF
      |
Next.js Web (Vercel)
      |
Fastify API Gateway ------------------------------------+
      |                                                 |
      +--> PostgreSQL <---- Indexer / Backfill Workers  |
      |                         |                       |
      +--> Redis/BullMQ         +--> Primary RPC/WS     |
      |                         +--> Secondary RPC      |
      +--> Object Storage       +--> Blockscout enrich |
      |                                                 |
      +--> Risk Engine Workers -------------------------+
      +--> Portfolio Engine
      +--> Alert Rule Engine --> Telegram / Email / Push / Webhooks
      +--> Auth/SIWE
      +--> Admin API
      |
Robinhood Chain contracts:
Token, AccessStaking, ProjectRegistry, ProjectBondVault,
ReportRegistry, TimelockController
```

## Monorepo services

### `apps/web`

Next.js application. It owns presentation, wallet connection, SIWE initiation, read-only public pages, authenticated dashboards, transaction preparation UI, and feature-flag-aware routing.

It must not:
- contain RPC provider secrets;
- query the database directly;
- calculate authoritative risk scores;
- submit a transaction without server/client simulation and intent display.

### `apps/api`

Fastify API with Zod schemas and OpenAPI generation. It owns authentication, authorization, public and private API routes, API keys, webhook management, project-profile writes, report submission, transaction-intent construction, and admin actions.

### `apps/indexer`

Long-running TypeScript service. It ingests blocks, transactions, receipts, logs, contract creation, ERC-20 transfers, known DEX events, protocol events, and application-contract events.

The service validates the versioned external protocol registry at startup. Only adapters with a
matching chain ID, runtime bytecode hash, and proxy state enter the routing manager. Raw logs persist
before adapter decoding. Adapter failures do not alter raw chain facts.

Modes:
- live WebSocket ingestion;
- gap repair;
- historical backfill;
- reorg reconciliation;
- derived-metric refresh.

### `apps/worker`

BullMQ consumers for:
- contract metadata;
- ABI/source retrieval;
- proxy resolution;
- bytecode analysis;
- holder snapshots;
- risk scans;
- wallet cost-basis calculation;
- trend calculation;
- alert evaluation;
- webhook delivery;
- notification delivery.
- protocol contract revalidation
- pool state refresh
- quote freshness validation

### `apps/telegram-bot`

Telegram account linking, watchlist commands, alert delivery, and signed deep links. No private-key functionality.

### `apps/admin`

Optional separate admin surface or protected route group. Requires passkey/MFA, RBAC, audit logging, and IP/device review.

## Provider strategy

### Canonical reads

Use a production archive-capable provider such as Alchemy as primary. Use a separately operated provider such as QuickNode as secondary. Compare chain ID and latest block on startup and continuously.

Public Robinhood RPC is suitable for development and emergency fallback only.

### Enrichment

Blockscout may provide:
- verified source and ABI;
- token holders;
- contract metadata;
- explorer links.

Never rely on Blockscout as the sole source for balances, event ordering, or state-changing decisions.

### Provider failover

A circuit breaker tracks:
- latency;
- error rate;
- latest block lag;
- chain ID;
- malformed responses.

Fail over reads automatically. Never broadcast the same signed transaction through multiple providers without transaction-hash deduplication.

## Indexing pipeline

1. Read next block from the checkpoint.
2. Fetch block, transactions, receipts, and matching logs.
3. Validate parent hash against the previous checkpoint.
4. Persist raw block/transaction/log facts in one database transaction.
5. Publish deterministic jobs keyed by chain/block/tx/log.
6. Update checkpoint.
7. Derive token, pool, transfer, wallet, and metric state.
8. Evaluate alerts.
9. Mark records with finality state.

### Reorg model

Store block hash and parent hash. When a mismatch occurs:
- find the common ancestor;
- mark orphaned blocks and all dependent raw facts;
- reverse or recompute derived records;
- replay canonical blocks;
- deduplicate notifications and issue correction events when a previously delivered alert was based on orphaned state.

Use immediate soft-confirmed data for UI. For irreversible or high-value product actions, require a stricter settlement state. Prefer provider support for `safe`/`finalized`; otherwise use a documented time-based fallback plus repeated canonical-hash verification.

## Data trust classes

- `CHAIN_FACT`: direct RPC result tied to block hash.
- `EXPLORER_ENRICHMENT`: source, ABI, labels, verification.
- `DERIVED`: computed metrics and classifications.
- `USER_ASSERTION`: project metadata, labels, reports.
- `ADMIN_DECISION`: moderation or dispute outcome.
- `EXTERNAL_MARKET_DATA`: quote or price provider response.

Every API response should preserve provenance internally, and critical UI findings should expose evidence.

## Authentication

Use Sign-In with Ethereum:
- server issues nonce;
- wallet signs EIP-4361 message;
- server validates domain, URI, chain ID, nonce, issued-at, expiration, and signature;
- nonce is single-use;
- session uses secure, HTTP-only, same-site cookie;
- sensitive actions require recent reauthentication.

Email/social authentication may be added for notification-only accounts, but wallet ownership claims require a wallet signature.

## Feature flags

At minimum:
- `TRADING_ENABLED`
- `TOKEN_STAKING_ENABLED`
- `PROJECT_BONDS_ENABLED`
- `REPORT_BONDS_ENABLED`
- `ADMIN_SLASHING_ENABLED`
- `GAS_SPONSORSHIP_ENABLED`
- `AI_EXPLANATIONS_ENABLED`
- `WEBHOOKS_ENABLED`
- `STOCK_TOKEN_MODULE_ENABLED`
- `MAINNET_WRITES_ENABLED`

Feature flags are server-controlled. The client may receive their state but cannot override them.

## Stock Token integration

Canonical Stock Tokens:
- are ERC-20 with 18 decimals;
- implement ERC-8056 UI multiplier behavior;
- require multiplier-aware display;
- use Chainlink feeds;
- require staleness, decimals, sequencer, and oracle-pause checks;
- may have corporate-action update events;
- must be separated from ordinary community tokens in the UI.

Do not hardcode Chainlink feed addresses. Seed them from the current official Chainlink registry and store source/verification metadata.

## Account abstraction

Robinhood Chain supports ERC-4337 and EIP-7702. Account abstraction is an optional adapter, not a core dependency. Implement provider interfaces for:
- standard EOA wallet;
- Alchemy smart wallet;
- ZeroDev kernel;
- Privy embedded wallet.

Gas sponsorship policies must:
- whitelist contract addresses and function selectors;
- cap value and gas;
- rate-limit per user/device;
- reject arbitrary calldata;
- maintain a kill switch and budget alerts.
