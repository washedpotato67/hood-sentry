# Hood Sentry Implementation Status

Last updated: 2026-07-14

Current phase: Foundation, indexer hardening, protocol adapters, deterministic market data,
discovery rankings, risk-engine framework, proxy analysis, source privilege analysis, fork
simulation, package decomposition, and live database bring-up

Launch audit status: local gates pass except production-backed integration and E2E evidence. All
write, launchpad, token-gating, sponsorship, and notification paths remain disabled.

Release readiness: Not ready for production

## Recent changes (2026-07-15)

- Added the Liquidity and Holder distribution deterministic rule families over the existing
  `analyzeLiquidityRisk` and `analyzeHolders` analyzers, following the proxy/privilege rule pattern.
  Liquidity covers unrecognised protocol, unverifiable lock, creator-held LP, abrupt removal, single
  provider, unexpected migration venue, and provider concentration. Holder distribution covers top-1
  and top-10 concentration of adjusted supply, Gini inequality, holder count, and circulating supply
  availability. Both are proven end to end through the real orchestrator and scoring, including
  category penalty caps and pinned provenance on every finding.
- Two honesty rules are enforced by tests rather than convention: a rule that withholds a conclusion
  (unverifiable lock, incomplete holder history, underivable circulating supply) reports `unknown`
  with zero confidence and carries a `maxPenaltyBps` of 0, so absence of evidence never moves the
  score; and unverified holder classifications never shrink measured concentration, so a
  self-reported treasury label cannot dilute a real insider position.

- Made the derived job type list a closed union (`DERIVED_JOB_TYPES`) exported from
  `@hood-sentry/queue` and used by both the indexer's `DerivedJob` and the worker's router. The
  router previously matched on invented names (`contract`, `token`, `pool`, `swap`, `liquidity`,
  `launchpad`) that no producer emits: of the 18 types the indexer actually publishes, only
  `transaction` and `log` matched, so the other 16 were logged as unknown and silently dropped.
  A type with no processor is now a compile error rather than a runtime no-op.
- The router now throws on an unrecognised type so it dead-letters for inspection instead of being
  acknowledged away, and lists deliberately-unimplemented types in `PENDING_JOB_TYPES` so "not
  built yet" is distinguishable from "dropped".
- Implemented the first three processors against the live database, each idempotent under
  at-least-once delivery: `contract-creation` (insert-only, so replays never clobber later
  enrichment), `token-transfer` (collapses on the log's natural key), and `token-approval`
  (applies only when strictly newer in `(block, log_index)` order). Migration 015 adds
  `token_approvals.last_updated_log_index`, without which two approvals in one block have no
  deterministic order and a redelivered stale job can roll an allowance backwards.

- Added indexer integration tests driving the real indexer against live PostgreSQL over a
  deterministic synthetic chain: reorg (orphaning the abandoned fork and reindexing the winning
  one), restart (checkpoint resume with no refetch or duplication), lease contention, gap repair,
  and malformed RPC responses (provider outage, missing block, receipt failure, malformed payload).
- Those tests exposed four defects that only a live database could reveal, all fixed in migration
  014 and `block-fetcher.ts`: the `blocks.finality_state` check allowed `confirmed` (which nothing
  emits) but rejected `soft_confirmed`, `safe`, and `orphaned`, so the indexer could not persist
  most blocks or complete a reorg; `transactions.status` and `transaction_receipts.status` were
  text with a `success`/`failed` check while the schema and every writer use integers; the
  `indexer_leases` primary key included `worker_id`, so two workers could hold a lease on the same
  stream and index it concurrently; and a malformed block or a failed receipt fetch was swallowed,
  persisting nothing (or a block missing its logs) while the checkpoint advanced past the height.
- Exposed the db migration helpers as `@hood-sentry/db/testing` so suites outside the db package
  can provision a clean, migrated database.

## Recent changes (2026-07-14)

- Decomposed the risk-engine monolith into focused domain packages (auth, portfolio-engine,
  alert-engine, admin-core, trading, launchpad, projects, reports, entitlements, ai); risk-engine
  now holds only the deterministic contract-risk core. Tests moved with their code; all gates green.
- Removed Robinhood Stock Token and ETF Token support across code, config, feature flags, schema,
  UI, migrations, and docs. `STOCK_TOKEN_MODULE_ENABLED` no longer exists.
- Stood up local PostgreSQL and Redis via docker-compose and applied all 13 migrations to a clean
  database for the first time. This surfaced and fixed two schema bugs that had blocked every
  migration: a single-column FK to a composite-keyed `transactions` table (001), and the reserved
  keyword `window` used unquoted as a column name (011).
- The db integration tests now execute against a real database instead of early-returning. Split
  them into `*.integration.test.ts` (excluded from the unit run), made each file self-provision a
  clean migrated schema, and fixed four test defects. Integration suite passes 14/14
  deterministically; the unit suite, typecheck, and lint remain green.
- Added the `@hood-sentry/queue` package: a durable BullMQ derived-jobs queue with idempotent
  publishing (idempotency key hashed to a colon-free BullMQ jobId), exponential-backoff retries, and
  a dead-letter path for exhausted jobs. Wired the indexer to publish (block-indexer transaction/log
  jobs and protocol-event jobs) and the worker to consume via a typed router. Verified against live
  Redis (queue integration suite 9/9). Per-type job processors behind the router remain to be built.

## Product goal

Hood Sentry targets Robinhood Chain token discovery, evidence-based contract risk analysis, wallet and portfolio tracking, liquidity and whale monitoring, alerts, verified project profiles, non-custodial trading, community reports, and SENTRY token access.

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
- Versioned DEX and launchpad adapter interfaces, normalized pool and event models, and a
  protocol-neutral adapter manager
- Startup protocol validation with chain ID checks, runtime bytecode hashes, proxy reconciliation,
  cached validation state, stale refresh, periodic revalidation, and operational alerts
- Verified Uniswap v2 Robinhood Chain mainnet adapter with registry-only contract loading,
  factory-event pool discovery, normalized swap and liquidity decoding, quotes, integer price
  impact, selector allowlists, and simulated transaction intent
- Protocol, contract-verification, pool, pool-token, swap, liquidity, quote, launchpad-token,
  bonding-curve trade, graduation, and migration persistence
- Raw-log-first protocol event routing with malformed-log isolation, deterministic derived jobs,
  duplicate protection, and reorg invalidation
- Read APIs for supported DEX protocols, disabled launchpads, verification state, pools, swaps,
  liquidity history, launch state, graduation, and migration
- Worker job implementations for protocol revalidation, pool state refresh, and quote freshness
- Deterministic integer-safe pricing engine with configurable Chainlink, bonding-curve, stablecoin
  pool, WETH route, direct DEX, multihop, external-provider, and unavailable source types
- Versioned price-source configuration, independent activation checks, source selection, confidence
  penalties, stale handling, outlier reason codes, and provider rate limits
- Price observations with contract, pool, route, provider, block, timestamp, liquidity, confidence,
  canonical state, and methodology provenance
- Reproducible OHLC and market metrics for 1m, 5m, 15m, 1h, 6h, 24h, 7d, and 30d windows
- Separate market capitalization and fully diluted valuation with reliable circulating-supply gates
- Bonding-curve to verified DEX migration transitions and pricing reorg invalidation
- Read APIs for current price, price history, candles, metrics, liquidity, market capitalization,
  fully diluted valuation, freshness, source status, and disagreement warnings
- Worker jobs for observation, OHLC, metrics, reconciliation, outliers, stale cleanup, migration,
  historical recomputation, and reorg recomputation
- Deterministic discovery feeds for new tokens, new pools, trending, metric gainers, launchpad
  transitions, verified projects, scans, critical findings,
  watchlists, and alerts
- Versioned `trending-v1` scoring with stored positive components, penalties, confidence, source
  block provenance, and no price-change score input
- Evidence records for self-trading, repeated wallet pairs, wallet volume concentration, circular
  flow, rapid buy and sell loops, tiny count-inflation trades, thin-pool impact, wallet clusters,
  and launchpad transaction bursts
- Exact-address-first search, duplicate-symbol warnings, address-based canonical ticker matching,
  discovery filters, and query-bound cursor pagination
- Separate sponsored placement rank, required disclosure, active dates, and append-only audit history
  without organic score or risk mutation
- Immutable discovery snapshots, current canonical projections, refresh jobs, and reorg invalidation
- Database-backed discovery source loading across canonical blocks, verified protocols, prices,
  market metrics, holders, swaps, launchpad trades, projects, risk, watchlists, alerts, deployer
  evidence, duplicate symbols, and data-quality records
- Read APIs for every discovery feed and cross-field token search
- Strict deterministic risk types for targets, scan context, rules, findings, evidence, severity,
  confidence, categories, results, scores, completeness, and methodology versions
- Versioned rule registry and rulesets with duplicate rejection, exact-version resolution,
  deterministic ordering, integer basis-point scoring, and immutable ruleset persistence
- Source-block and block-hash pinning, provider attribution, stable finding fingerprints, reasoned
  suppression, scan and per-rule timeouts, cancellation, partial results, and rule failure isolation
- Completeness accounting where unknown results and failed data dependencies reduce coverage without
  being treated as passes
- Idempotent scan claims and rescan requests for all required chain, launchpad, analyst, and
  methodology triggers
- Persistent canonical risk history with finding evidence, scores, completeness detail,
  cancellation state, trigger provenance, and reorg invalidation
- Worker jobs for deterministic scans, rescan trigger storage, duplicate rejection, and reorg
  invalidation
- Pinned proxy analysis for EIP-1967 implementation, admin, and beacon slots, transparent and UUPS
  proxies, EIP-1167 clones, clone factories, nested proxies, common diamonds, and unknown
  delegatecall proxies
- Direct upgrade-authority resolution for owners, EOAs, Safe thresholds and owners, timelock delays,
  implementation code hashes, initialization state, and recent upgrade events
- Non-authoritative explorer comparison which preserves direct chain implementation and admin state,
  records conflicts, and emits data-quality findings
- Deterministic Solidity structural AST analysis for inheritance, modifiers, privileged functions,
  controlling state variables, bounds, initializers, and external call surfaces
- Current Ownable and AccessControl controller resolution with EOA, Safe, timelock, contract,
  renounced, and unknown classifications
- Versioned proxy and privilege risk rules with explicit source, ABI, and bytecode-selector confidence
  levels and no AI scoring
- Worker risk-context composition which keeps chain proxy and privilege analysis operational during
  Blockscout outages
- Anvil fork simulation service with fixed-block configuration, disposable local accounts, snapshot
  rollback, local-only JSON-RPC execution, timeout quarantine, hypothetical-state labels, balance and
  allowance probes, revert capture, and buy-sell risk findings
- Fastify API shell with health routes and security headers
- A legacy fixed-supply SentryToken test package remains in the repository. The external protocol
  adapter runtime does not deploy, maintain, or reference its contracts.
- Minimal Next.js landing page

### Partial

- Derived indexer jobs now publish to a durable BullMQ queue (`@hood-sentry/queue`) with idempotency keys, retries, and a dead-letter path; the worker consumes them through a typed router. Per-type business processing is still a stub in the router.
- Token discovery emits contract and ERC-20 event jobs. Blockscout enrichment and contract analysis
  context loading exist, but no durable worker queue invokes them yet. Token metadata calls, holder
  snapshots, and worker queue execution are absent. Protocol pool, swap, liquidity, launchpad, and
  reorg persistence paths now exist.
- Live PostgreSQL migration and repository validation is pending. Deterministic adapter and indexer
  integration tests cover protocol behavior without a database service.
- The API exposes health, external protocol, price, candle, market-metric, discovery, and search
  read routes. Most authenticated product routes remain absent.
- The web app exposes a static product title only.
- Deterministic proxy and source privilege rules exist. Liquidity, holder, deployer, identity,
  market, oracle, and launchpad risk rules remain absent.

### Skeleton or absent

- Remaining production risk rules and public risk report APIs
- Wallet balances, cost basis, approvals, and portfolio P&L
- Alert evaluation and in-app, Telegram, email, push, and webhook delivery
- SIWE authentication and session management
- Project profile claims and contract verification flow
- Community reports, moderation, and appeals
- Non-custodial quote, simulation review, approval, and swap flows
- Holding-based premium token entitlements
- Verified external launchpad and official `$SENTRY` production records
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
- Added a protocol-neutral liquidity adapter system and enabled only the independently verified
  Uniswap v2 mainnet factory and Router02 deployment.
- Added pool creation, swap, liquidity add and remove, malformed log, unsupported fee, unknown
  factory, duplicate pool, wrong address, canonical factory mapping, and verified and unverified
  quote and transaction tests.
- Expanded the adapter contract for launchpad creation, curve trades, graduation, and migration.
- Added versioned contract-role validation, runtime and proxy checks, cached activation state,
  periodic refresh, adapter initialization isolation, and operational failure records.
- Added protocol persistence migration 010 with an explicit legacy market-data backfill stop.
- Connected raw-log-first pool, swap, liquidity, and launchpad routing to the indexer.
- Added derived record invalidation for swap and migration reorg replacement.
- Added protocol read routes and worker jobs for protocol refresh, pool refresh, and quote checks.
- Added fixture coverage for launchpad creation, buys, sells, graduation, migration, duplicate
  migration, provider outage, bytecode changes, failed initialization, and API serialization.
- Added migration 011 for versioned price sources, deterministic observations, candles, and metrics.
- Added exact pool, Chainlink, bonding-curve, migrated-pool, and external-provider evaluation paths.
- Added thin-pool, depeg, stale feed, disagreement, negative price, zero price, decimal conversion,
  integer rounding, large bigint, missing circulating supply, and reorged swap tests.
- Added source, freshness, history, candle, and windowed metric APIs with null unavailable values.
- Added migration 012 for immutable discovery history, current projections, sponsored placement,
  and sponsorship audit history.
- Added deterministic trending components, integer log scaling, explainable manipulation penalties,
  feed-specific comparators, filtering, address-first search, canonical ticker protection, and
  cursor pagination.
- Added discovery refresh and reorg jobs plus discovery and search API routes.
- Added organic growth, wash pattern, wallet concentration, thin liquidity, token age, duplicate
  ticker, sponsorship, launchpad graduation, reorg, missing data, and cursor tests.
- Added migration 013 for pinned risk provenance, finding status, immutable rulesets, scan
  idempotency, cancellation, suppressions, rescan triggers, and canonical reorg state.
- Added deterministic risk orchestration with timeouts, cancellation, rule isolation, completeness,
  integer scoring, stable fingerprints, evidence preservation, and versioned behavior.
- Added risk scan, rescan trigger, and reorg jobs with duplicate claim protection.
- Added direct EIP-1967, beacon, UUPS, transparent, clone, diamond, nested, and unknown delegatecall
  proxy analysis with implementation bytecode hashes and storage-slot evidence.
- Added Safe, timelock, EOA, owner, role-holder, initialization, recent-upgrade, and explorer-conflict
  evidence with versioned proxy findings.
- Added verified Solidity structural parsing, inheritance closure, modifier and role analysis,
  privilege bounds, current controllers, external calls, ABI fallback, and low-confidence bytecode
  selector heuristics.
- Added fixture coverage for proxy types, authority types, initialization, explorer disagreement,
  Ownable, AccessControl, multiple roles, bounded and unbounded authority, hidden blacklist, rebase,
  reflection, mutable router, arbitrary calls, and unverified bytecode.
- Added Anvil simulation fixtures for standard transfers, honeypot sell failures, fee-on-transfer,
  hypothetical state, balance and allowance changes, timeout quarantine, and unverified routes.
- Added bigint-only holder and supply analysis with visible exclusions, raw and adjusted concentration,
  Gini, rebase uncertainty, and concentration-change alerts.
- Added liquidity-risk analysis for verified protocols, lock evidence, creator liquidity, removals,
  provider concentration, shallow pools, and unexpected migrations.
- Added bounded relationship graph traversal with chain provenance, confidence, pagination, and
  external-label attribution.
- Added deterministic weighted risk scoring with caps, grades, completeness, confidence, historical
  methodology versions, and score-change explanations.
- Added oracle status validation for freshness, invalid answers, pauses, sequencer state, and grace
  periods, plus portfolio reconciliation outputs with exact and estimated values.

## Verification on 2026-07-14

- `pnpm format:check`: passed
- `pnpm lint`: passed with eight complexity warnings in indexer and deterministic analysis code
- `pnpm typecheck`: passed
- `pnpm test`: passed across all 31 workspace tasks, including 66 risk-engine cases and 6 Forge tests
- `pnpm test:integration`: passed. All 14 database service cases returned early because PostgreSQL
  was unavailable.
- `pnpm build`: passed for all 21 workspaces
- `pnpm --filter contracts forge:test`: passed, 6 tests
- `pnpm --filter contracts forge:coverage`: passed, 100 percent line coverage and 50 percent branch coverage for SentryToken
- `pnpm test:e2e`: command passed but is a placeholder and runs no browser tests
- `pnpm audit --audit-level high`: passed after upgrading Vitest, Drizzle ORM, OpenTelemetry, Vite,
  and protobuf.js. Six moderate advisories remain.
- Codex Security bounded repository review: no open reportable finding survived validation and
  attack-path policy calibration. Fifteen high-impact files were reviewed and 1,662 inventory rows
  were deferred, so this is not an exhaustive security clearance.
- TruffleHog and CodeQL are configured in CI. Their hosted scans were not executed locally because
  their runners are unavailable in this environment.

PostgreSQL was unavailable, so clean migration and repository integration validation remains
pending, including live application of migrations 009, 010, 011, 012, and 013. The indexer,
adapter, API, worker, and Blockscout paths have deterministic local coverage.

## Active release blockers

1. Done locally: PostgreSQL and Redis run via docker-compose, all migrations apply on a clean database, and the db integration tests run without early returns. Still pending: the same on a production-backed managed database with backup/restore evidence.
2. Done: derived jobs publish to a durable BullMQ queue (`@hood-sentry/queue`) with idempotency keys (hashed to a colon-free BullMQ jobId), exponential-backoff retries, and a dead-letter path; the indexer publishes and the worker consumes via a typed router. Job types are a closed union (`DERIVED_JOB_TYPES`) shared by producer and consumer, so an unroutable type cannot compile. Processors exist for `contract-creation`, `token-transfer`, and `token-approval`, each idempotent under at-least-once delivery. Remaining: the 15 job types still listed in `PENDING_JOB_TYPES`, which depend on blockers 4 and 5.
3. Done: `apps/indexer/src/__tests__/indexer.integration.test.ts` drives the indexer against live PostgreSQL over a synthetic chain (`synthetic-chain.ts`) covering reorg, restart, lease contention, gap repair, and malformed RPC responses. These found and fixed four real defects: the `blocks.finality_state` check rejected every state the indexer emits except `pending`/`finalized`, `transactions.status` and `transaction_receipts.status` were text while all code writes integers, the `indexer_leases` primary key included `worker_id` so leases granted no mutual exclusion, and a malformed block or failed receipt fetch was silently skipped while the checkpoint advanced past it. See migration 014.
4. In progress. Liquidity (7 rules) and Holder distribution (5 rules) are implemented over the
   existing deterministic analyzers, registered, and proven end to end through the orchestrator.
   Still absent: deployer, identity, market, oracle, metadata, and launchpad rules, which have no
   analysis layer yet, and the evidence-backed report APIs. The two new families are also not yet
   reachable in production: `contract-analysis-context.ts` only loads proxy and privilege data, so
   it must supply `holderAnalysis`, `liquidityAnalysis`, and their pinned data sources before a
   real scan can evaluate them. Risk scores stay unexposed until this blocker closes.
5. Build token, wallet, portfolio, alert, project, report, and trading API routes and product screens.
6. Keep project verification, reports, and token access offchain. Sentry has no application-owned
   contract dependency. Verify the external launchpad-created `$SENTRY` address, creation
   transaction, bytecode, treasury Safe, and launchpad state before token access is enabled.
7. Verify deployment addresses, contract source, Safe ownership, oracle sources, and sequencer
   checks before enabling writes.
8. Run staging load, failover, backup, restore, alert delivery, and transaction simulation tests.
9. Verify Chainlink proxy and sequencer addresses, feed decimals, and heartbeat values before
   enabling WETH, stablecoin, or other oracle sources.

All transactional feature flags should stay disabled until their related blocker and security gate passes.

## Launch-gate flags

- `MAINNET_WRITES_ENABLED`: disabled
- `TRADING_ENABLED`: disabled
- `TOKEN_GATE_ENABLED`: disabled
- `GAS_SPONSORSHIP_ENABLED`: disabled
- `AI_EXPLANATIONS_ENABLED`: disabled
- `WEBHOOKS_ENABLED`: disabled
- `PROJECT_CLAIMS_ENABLED`: disabled
- `COMMUNITY_REPORTS_ENABLED`: disabled
- launchpad adapters: disabled until verified production contracts exist

## Security review summary

The dependency scan initially found one critical and three high advisory families. Patched versions
were installed and the follow-up audit reports no critical or high advisories. The application review
found a public API work-amplification path and a CSP nonce propagation defect. Global API throttling,
safe schema and framework errors, and request-side nonce propagation were added. SIWE validation now
binds the message nonce to the stored nonce and uses the injected verification time for expiry. The CI
dependency audit now fails on high advisories and TruffleHog is pinned to an immutable release commit.
Trading, launch review, token gating, gas sponsorship, and official-token helpers have incomplete
production bindings and remain disabled.

Rollback point before this audit is commit `ace6bc1`. Production deployment, backfill, browser QA,
restore testing, state reconciliation, and smoke trading remain unproven. Official `$SENTRY` and
verified launchpad details are unavailable and intentionally omitted rather than inferred.
