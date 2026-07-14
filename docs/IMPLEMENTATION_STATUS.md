# Hood Sentry Implementation Status

Last updated: 2026-07-14

Current phase: Foundation, indexer hardening, protocol adapters, deterministic market data,
discovery rankings, risk-engine framework, proxy analysis, and source privilege analysis

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
  transitions, verified projects, scans, critical findings, canonical Stock Tokens and ETF Tokens,
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
- Fastify API shell with health routes and security headers
- A legacy fixed-supply SentryToken test package remains in the repository. The external protocol
  adapter runtime does not deploy, maintain, or reference its contracts.
- Minimal Next.js landing page

### Partial

- Derived indexer jobs only reach structured logs. No Redis or BullMQ publisher connects the indexer to a worker.
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
- Community reports, bonds, moderation, and appeals
- Non-custodial quote, simulation review, approval, and swap flows
- Live Robinhood Stock Token and ETF Token feed activation, multiplier refresh, and corporate-action handling
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
  ticker, fake Stock Token, sponsorship, launchpad graduation, reorg, missing data, and cursor tests.
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

## Verification on 2026-07-14

- `pnpm format:check`: passed
- `pnpm lint`: passed with three existing indexer complexity warnings
- `pnpm typecheck`: passed
- `pnpm test`: passed, 548 Vitest cases reported passing and 6 Forge tests passed
- `pnpm test:integration`: passed. All 14 database service cases returned early because PostgreSQL
  was unavailable.
- `pnpm build`: passed for all 21 workspaces
- `pnpm --filter contracts forge:test`: passed, 6 tests
- `pnpm --filter contracts forge:coverage`: passed, 100 percent line coverage and 50 percent branch coverage for SentryToken

PostgreSQL was unavailable, so clean migration and repository integration validation remains
pending, including live application of migrations 009, 010, 011, 012, and 013. The indexer,
adapter, API, worker, and Blockscout paths have deterministic local coverage.

## Active release blockers

1. Start PostgreSQL and Redis, apply every migration on a clean database, and run database integration tests without early returns.
2. Publish derived jobs to a durable queue with idempotency keys, retries, and a dead-letter path.
3. Add synthetic reorg, restart, lease contention, gap repair, and malformed RPC response integration tests.
4. Implement the remaining deterministic liquidity, holder, deployer, identity, market, oracle,
   metadata, and launchpad rules plus evidence-backed report APIs before exposing risk scores.
5. Build token, wallet, portfolio, alert, project, report, trading, and Stock Token API routes and product screens.
6. Implement and test the missing staking, bond, registry, report, vesting, and timelock contracts.
7. Verify deployment addresses, contract source, Safe ownership, timelock roles, oracle sources, and sequencer checks before enabling writes.
8. Run staging load, failover, backup, restore, alert delivery, and transaction simulation tests.
9. Verify Chainlink proxy and sequencer addresses, feed decimals, and heartbeat values before
   enabling Stock Token, ETF Token, WETH, stablecoin, or other oracle sources.

All transactional feature flags should stay disabled until their related blocker and security gate passes.
