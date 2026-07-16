# Oracle behavior + Market integrity risk-rule families — design

- Date: 2026-07-16
- Status: approved for planning
- Related: `docs/RISK_ENGINE.md`, `docs/IMPLEMENTATION_STATUS.md` blocker 4, commit `33ea893` (Chainlink oracle pipeline)

## Context and goal

`RISK_CATEGORIES` declares twelve categories. Four have deterministic rule families today
(Contract control / Upgradeability via proxy + privilege, Liquidity, Holder distribution). Six
remain empty: **Oracle behavior**, **Market integrity**, Deployer history, Identity and
impersonation, Metadata quality, and Launchpad behavior.

This work fills **Oracle behavior** and **Market integrity**. Oracle behavior consumes the Chainlink
observation pipeline landed in `33ea893` (migration 029 columns: `round_id`, `answered_in_round`,
`oracle_paused`, `sequencer_up`, `sequencer_recovered_at`, plus `oracle_heartbeat_seconds` and
`sequencer_feed_address` on the source config). Market integrity reuses two existing engines as
libraries: `@hood-sentry/market-engine` (price selection, disagreement, outliers) and
`@hood-sentry/discovery-engine` (`analyzeManipulation`).

### Non-goals

- Does **not** open `RISK_SCORES_ENABLED`. That flag opens only when every category in
  `RISK_CATEGORIES` has rules (or completeness is redefined). Four categories remain after this work.
- Does **not** add new manipulation or pricing logic. The risk rules interpret pinned results from
  existing engines; they do not recompute wash-trading or price selection.
- Does **not** verify or configure real Chainlink feed addresses for Robinhood Chain (still blocker 9).
  These rules only fire when an oracle source is configured; today none is.

## Architecture

The established pattern (`liquidity-risk.ts` analyzer + `liquidity-rules.ts` rules + a worker-side
`LiquidityRiskContextLoader`) is followed exactly. The risk-engine stays a pure, synchronous-ish
interpreter over pinned data; the worker loaders do all DB access and engine invocation.

```
worker loader (pinned: DB rows + engine call)
   → context.data[<provenance key>]        (serialized, block-pinned)
   → risk-engine rule.evaluate(context)     (deterministic interpretation)
   → RiskRuleEvaluation → RiskFinding
```

Both categories obey the honesty rules already enforced elsewhere:

- Absence of evidence never moves the score: `unknown` and `not_applicable` carry `maxPenaltyBps` 0.
- `unknown` reduces completeness (data was required but missing/unreadable). `not_applicable` does
  not (the determination was definitive — the category genuinely does not apply to this token).
- Every finding pins `sourceBlock` / `sourceBlockHash` and lists its provenance keys.

### N/A vs unknown mapping (the completeness-trap decision)

The orchestrator's `completeness()` counts only `unknown` findings against coverage; `not_applicable`
counts as a completed rule with no penalty. Most Robinhood Chain tokens have no oracle and new tokens
have too few trades to judge manipulation, so the mapping below is what keeps the common token able to
reach full completeness while staying honest:

| Situation | Status |
|---|---|
| Condition definitively holds | `fail` / `warning` (per rule) |
| Condition definitively absent | `pass` |
| Category does not apply (no oracle configured; activity below threshold) | `not_applicable` |
| Required data configured but unreadable at the pinned block | `unknown` |

A `not_applicable` finding marks its provenance source `available` (config/observation *was* read;
the "no oracle" conclusion is complete), so it does not trip `DATA_SOURCES_UNAVAILABLE`.

## 1. Oracle behavior rules

- Category: `'Oracle behavior'`
- Provenance key: `oracle_observation_state`
- Loader: `OracleBehaviorContextLoader` (worker)
- Rule factory: `createOracleRiskRules(): readonly RiskRule[]` in `oracle-rules.ts`
- Analyzer + result type: `oracle-analysis.ts` / `oracle-types.ts`

The loader reads the token's configured oracle price source(s) and the latest oracle observation with
block ≤ scan block, projecting the migration-029 state into an `OracleBehaviorResult`:
`{ applicable, source, answerRaw, decimals, roundId, answeredInRound, updatedAt, heartbeatSeconds,
oraclePaused, sequencerConfigured, sequencerUp, sequencerRecoveredAt, sourceBlock, warnings }`.
`applicable=false` when no oracle source is configured for the token.

| Rule id | Condition (present) | Status | Severity |
|---|---|---|---|
| `oracle.oracle_stale` | `now - updatedAt > heartbeatSeconds` | `fail` | high |
| `oracle.oracle_answer_invalid` | `answerRaw <= 0` | `fail` | high |
| `oracle.oracle_incomplete_round` | `answeredInRound < roundId` | `warning` | medium |
| `oracle.oracle_paused` | `oraclePaused === true` | `fail` | high |
| `oracle.sequencer_down` | `sequencerConfigured && sequencerUp === false` | `fail` | critical |
| `oracle.sequencer_grace_period` | recovered within grace window (`SEQUENCER_GRACE_SECONDS`) | `warning` | medium |

Applicability per rule:

- `applicable === false` → every rule returns `not_applicable`.
- `applicable === true` but observation unreadable at block → `unknown`.
- Sequencer rules with `sequencerConfigured === false` → `not_applicable` (no L2 sequencer feed to
  check), independent of the price-feed rules.

`SEQUENCER_GRACE_SECONDS` default: 3600 (Chainlink's standard L2 grace period). Configurable constant
in `oracle-rules.ts`, not env-driven.

## 2. Market integrity rules

- Category: `'Market integrity'`
- Provenance keys: `market_price_reliability` and `market_trade_manipulation`
- Loader: `MarketIntegrityContextLoader` (worker), producing one `MarketIntegrityContext` with two
  independently-available halves.
- Rule factory: `createMarketIntegrityRiskRules(): readonly RiskRule[]`

### 2a. Price-reliability (from `@hood-sentry/market-engine`)

The loader runs the existing price selection over the token's active sources at the pinned block and
captures `disagreementWarnings`, outlier detection (`detectOutliers`), and observation reason codes.

| Rule id | Condition | Status | Severity |
|---|---|---|---|
| `market.source_price_disagreement` | any `SOURCE_DISAGREEMENT:*` warning present | `warning` | medium |
| `market.price_outlier` | outlier detected at scan block | `warning` | medium |
| `market.single_transaction_price_manipulation` | `ONE_TRANSACTION_MANIPULATION` reason present | `fail` | high |

Applicability: fewer than 2 active price sources → `source_price_disagreement` is `not_applicable`
(nothing can disagree). No price observation at the block → all three `unknown`.

### 2b. Trade-based manipulation (from `@hood-sentry/discovery-engine`)

The loader reads pinned trade history (swaps with block ≤ scan block for the token's canonical
pool(s)) and calls `analyzeManipulation`. Each risk rule is a thin, versioned projection of one
`ManipulationSignalCode`, carrying `MANIPULATION_METHODOLOGY_VERSION` (`manipulation-v1`) in its
evidence so the provenance points back to the discovery methodology.

| Rule id | Discovery signal | Status | Severity |
|---|---|---|---|
| `market.wash_self_trading` | `SELF_TRADING` | `fail` | high |
| `market.repeated_wallet_pair` | `REPEATED_WALLET_PAIR` | `warning` | medium |
| `market.wallet_volume_concentration` | `ONE_WALLET_VOLUME_CONCENTRATION` | `warning` | medium |
| `market.circular_wallet_volume` | `CIRCULAR_WALLET_VOLUME` | `warning` | medium |
| `market.rapid_buy_sell_loop` | `RAPID_BUY_SELL_LOOP` | `warning` | medium |
| `market.tiny_trade_count_inflation` | `TINY_TRADE_COUNT_INFLATION` | `warning` | medium |
| `market.thin_pool_price_manipulation` | `THIN_POOL_PRICE_MANIPULATION` | `warning` | medium |

Applicability: trade count in the pinned window below `MARKET_MIN_TRADES_FOR_MANIPULATION` (default
**20**) → all trade-based rules `not_applicable` (insufficient activity to conclude manipulation).
DB read failure → `unknown`. A signal absent while activity is sufficient → `pass`.

`MARKET_MIN_TRADES_FOR_MANIPULATION` is a constant in `market-integrity-rules.ts` with a documented
rationale, not env-driven, so scans stay reproducible.

## 3. Worker context loaders

Two loaders added under `apps/worker/src/jobs/`, chained into `risk-runtime.ts` alongside the existing
`ContractAnalysisContextLoader`, `HolderDistributionContextLoader`, `LiquidityRiskContextLoader`, and
`CanonicalRiskContextLoader`. Each:

- Reads only pinned data (block ≤ scan block), compares the canonical indexed block hash with the
  scan target, and marks its `RiskDataSource` `available` / `unavailable` / `stale` accordingly.
- Serializes bigints to strings in `context.data` (matching the liquidity loader's
  `serialized*` helpers) so the frozen context stays JSON-safe.
- Never throws for "no oracle" / "thin activity" — those are data states the rules read, not errors.

## 4. Registration, ruleset, scoring

- Register all 16 rules (6 oracle + 3 price-reliability + 7 trade-based) in `registry.ts` via the
  existing duplicate-rejecting registration. The plan confirms no rule id collides with existing ones.
- Add both categories to the versioned ruleset with `categoryPenaltyCapsBps` entries. Proposed caps:
  Oracle behavior 3000, Market integrity 3000 (a single category should not dominate the aggregate).
- Bump the ruleset version and methodology version; the previous ruleset stays immutable in history.
- `maxPenaltyBps` per rule: `high` → 2500, `medium` → 800, and `sequencer_down` (critical) → 3000 (the
  category cap, so a downed sequencer can fully consume the Oracle-behavior budget); `unknown` /
  `not_applicable` → 0. No per-rule penalty exceeds its category cap. Final numbers are confirmed in
  the plan against `deterministic-score.ts`.

## 5. Testing

**Unit (`packages/risk-engine/src/__tests__/`):**

- `oracle-rules.test.ts`: each condition present / absent / not_applicable (no source) / unknown
  (source configured, observation missing); sequencer-not-configured path; grace-period boundary.
- `market-integrity-rules.test.ts`: each price-reliability and trade-based rule present / absent;
  below-threshold → not_applicable; fetch-failure → unknown; 1:1 mapping to each discovery signal.
- Honesty tests: `not_applicable` and `unknown` yield `maxPenaltyBps` 0 and do not deduct; `unknown`
  lowers completeness while `not_applicable` does not (assert through the orchestrator).

**Integration (`apps/worker/src/__tests__/`, live PostgreSQL):**

- `OracleBehaviorContextLoader` over seeded migration-029 observation rows: healthy, stale, paused,
  answer≤0, sequencer-down, no-source.
- `MarketIntegrityContextLoader` over seeded price sources (agreeing / disagreeing) and seeded trades
  (clean / wash-trading / below-threshold).

## Files

**Create:** `packages/risk-engine/src/oracle-analysis.ts`, `oracle-rules.ts`, `oracle-types.ts`,
`market-integrity-analysis.ts`, `market-integrity-rules.ts`, `market-integrity-types.ts`, and their
`__tests__`; `apps/worker/src/jobs/oracle-behavior-context.ts`, `market-integrity-context.ts`, and
integration tests.

**Modify:** `packages/risk-engine/src/registry.ts` (register rules), the ruleset definition and
version, `packages/risk-engine/src/index.ts` (exports), `apps/worker/src/jobs/risk-runtime.ts` (chain
the two loaders), `docs/IMPLEMENTATION_STATUS.md` (mark the two categories done; state the flag stays
closed with four categories remaining).

## Blocker impact

Closes 2 of 6 missing categories for blocker 4. `RISK_SCORES_ENABLED` stays closed; Deployer history,
Identity and impersonation, Metadata quality, and Launchpad behavior remain. `IMPLEMENTATION_STATUS.md`
will say exactly this rather than implying the flag can open.
