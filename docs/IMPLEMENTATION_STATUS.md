# Hood Sentry Implementation Status

Last updated: 2026-07-14

Current phase: Foundation, indexer hardening, and explorer enrichment

Release readiness: Not ready for production

## Product goal

Hood Sentry targets Robinhood Chain token discovery, evidence-based contract risk analysis, wallet and portfolio tracking, liquidity and whale monitoring, alerts, verified project profiles, non-custodial trading, community reports, SENTRY token access, and Robinhood Stock Token support.

## Current implementation

### Implemented and tested

- pnpm and Turborepo monorepo structure
- Strict TypeScript configuration
- Biome formatting and lint checks
- Zod environment validation
- Structured logging, redaction, metrics, tracing, and error normalization
- Server-controlled feature flag service
- Robinhood Chain definitions, address registries, RPC failover support, provider health tracking, retries, rate limits, and circuit breakers
- PostgreSQL schema, migrations, and typed repository implementations
- Raw block, transaction, receipt, and log persistence
- Indexer checkpoints, leases, gap scanning, reorg handling, and historical modes
- Contract creation, ERC-20 Transfer, and ERC-20 Approval discovery jobs
- Typed Blockscout contract enrichment with bounded responses, ABI validation, source hashing,
  provenance, retries, request timeouts, rate limiting, and stale cache fallback
- Persistent explorer metadata cache separated from direct chain facts
- Proxy metadata reconciliation which keeps chain implementation and admin values authoritative,
  preserves Blockscout values, and records data-quality conflicts
- Fastify API shell with health routes and security headers
- Fixed-supply SentryToken contract with ERC-20 Permit
- Minimal Next.js landing page

### Partial

- Derived indexer jobs only reach structured logs. No Redis or BullMQ publisher connects the indexer to a worker.
- Token discovery emits contract and ERC-20 event jobs. Blockscout enrichment exists as a typed
  client and database adapter, but no durable worker queue invokes the enrichment job yet. Token
  metadata calls, bytecode analysis, chain-derived proxy analysis, holder snapshots, verified DEX
  adapters, pool discovery, and swap decoding are absent.
- The database schema and repositories are broad. Live PostgreSQL integration validation is pending.
- The API exposes health routes only.
- The web app exposes a static product title only.
- The risk engine defines schemas only.

### Skeleton or absent

- Risk rules, scoring, evidence generation, and risk reports
- Wallet balances, cost basis, approvals, and portfolio P&L
- Alert evaluation and in-app, Telegram, email, push, and webhook delivery
- SIWE authentication and session management
- Project profile claims and contract verification flow
- Community reports, bonds, moderation, and appeals
- Non-custodial quote, simulation review, approval, and swap flows
- Robinhood Stock Token multiplier, oracle, and corporate-action support
- Premium access staking
- Project bond, report bond, registry, vesting, timelock, and deployment contracts
- Admin product surface
- Production deployment and live-service validation

## Repairs completed on 2026-07-14

- Removed repeated indexer type declarations which broke lint and TypeScript compilation.
- Fixed the BlockIndexer constructor call used by indexer startup.
- Preserved block zero as a valid block number across discovery, persistence, and historical mode checks.
- Read deployed contract addresses from successful transaction receipts instead of null transaction destinations.
- Added strict ERC-20 event shape checks, checksummed decoded addresses, and decimal-safe raw values.
- Removed fabricated pool event signatures and unfinished proxy and token detection stubs from the ingestion path.
- Rejected logs missing transaction hash or log index instead of storing fake provenance.
- Stored receipt effective gas price instead of deriving a false value from cumulative gas usage.
- Replaced the fabricated raw transaction hash with Ethereum Keccak-256.
- Added a chain ID check before raw transaction broadcast.
- Rejected provider responses whose transaction hash does not match the signed payload.
- Removed full RPC and Redis URLs from startup log fields.
- Added four indexer discovery tests and one transaction hash regression test.
- Added isolated Blockscout enrichment storage so explorer claims never replace direct chain facts.
- Added verified, unverified, malformed ABI, rate limit, outage, timeout, proxy disagreement, large
  response, and stale refresh coverage.

## Verification on 2026-07-14

- `pnpm format:check`: passed
- `pnpm lint`: passed with three existing indexer complexity warnings
- `pnpm typecheck`: passed
- `pnpm test`: passed, 402 Vitest tests and 6 Forge tests executed
- `pnpm test:integration`: command passed, but all 10 database cases returned early because PostgreSQL was unavailable
- `pnpm build`: passed for all 19 workspaces
- `pnpm --filter contracts forge:test`: passed, 6 tests
- `pnpm --filter contracts forge:coverage`: passed, 100 percent line coverage and 50 percent branch coverage for SentryToken

Docker Desktop was not running, so clean migration and repository integration validation remains
pending, including live application of migration 009. The indexer decoding and Blockscout enrichment
paths have deterministic unit coverage.

## Active release blockers

1. Start PostgreSQL and Redis, apply every migration on a clean database, and run database integration tests without early returns.
2. Publish derived jobs to a durable queue with idempotency keys, retries, and a dead-letter path.
3. Add synthetic reorg, restart, lease contention, gap repair, and malformed RPC response integration tests.
4. Implement deterministic risk rules and evidence-backed reports before exposing risk scores.
5. Build token, wallet, portfolio, alert, project, report, trading, and Stock Token API routes and product screens.
6. Implement and test the missing staking, bond, registry, report, vesting, and timelock contracts.
7. Verify deployment addresses, contract source, Safe ownership, timelock roles, oracle sources, and sequencer checks before enabling writes.
8. Run staging load, failover, backup, restore, alert delivery, and transaction simulation tests.

All transactional feature flags should stay disabled until their related blocker and security gate passes.
