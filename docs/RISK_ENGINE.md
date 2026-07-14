# Deterministic Risk Engine

## Principle

A score is a summary, not evidence. The product must show findings first and score second.

Each rule returns:

```ts
type RiskFinding = {
  ruleId: string;
  ruleVersion: string;
  status: "pass" | "warning" | "fail" | "unknown" | "not_applicable";
  category: RiskCategory;
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: {
    level: "unknown" | "low" | "medium" | "high" | "confirmed";
    basisPoints: number;
    rationale: string;
  };
  title: string;
  explanation: string;
  evidence: RiskEvidence[];
  remediation: string | null;
  sourceBlock: bigint;
  sourceBlockHash: `0x${string}`;
  dataProvenance: RiskDataSource[];
  fingerprint: `0x${string}`;
  suppressed: boolean;
  suppressionReason: string | null;
};
```

Unknown is not pass. Missing source, unavailable simulation, or inaccessible holder data reduces completeness.

## Framework

The deterministic framework lives in `packages/risk-engine`. The framework does not contain AI
scoring or AI-generated findings.

- `RiskRuleRegistry` stores immutable rule ID and version pairs and rejects duplicates.
- A ruleset names exact rule versions, a methodology version, and integer category penalty caps.
- The orchestrator resolves exact versions, sorts rules by category, rule ID, and version, and pins
  every finding to one source block and block hash.
- Each required data source includes provider attribution, availability, source block, source block
  hash, fetch time, and failure reason.
- Missing, stale, or failed required data produces `unknown`. The result loses completeness.
- Rule exceptions and timeouts produce isolated `unknown` findings. Other rules continue.
- Scan timeouts preserve completed findings and mark remaining findings `unknown`.
- An `AbortSignal` stops a scan. Cancellation preserves partial evidence.
- Fingerprints use the target, rule ID, rule version, and rule-owned stable condition key. A rescan at
  another block keeps the same fingerprint for the same condition.
- Suppressions require a fingerprint or rule ID and a written reason. Suppression never deletes the
  finding, changes its severity, or changes its score.

Risk score arithmetic uses integer basis points. Unknown findings do not add a risk penalty because
missing evidence does not prove risk. Unknown findings reduce completeness and add an unresolved-data
warning. The API must present score and completeness together.

## Persistence and jobs

Migration 013 extends risk storage with:

- source block hashes and canonical state
- finding statuses and pinned source provenance
- immutable ruleset versions
- reasoned suppressions and revocation state
- scan and rescan idempotency keys
- cancellation request state
- completeness detail
- all supported rescan trigger types
- reorg invalidation without historical deletion.

`RiskScanJob` claims a unique engine, ruleset, methodology, target, and source-block job before
execution. A duplicate claim returns the existing scan ID. `RiskRescanTriggerJob` stores trigger
provenance before queue execution. `RiskReorgJob` marks affected scan and request history
noncanonical.

The following events request a rescan:

- new token
- source verification
- proxy implementation change
- ownership change
- role change
- mint
- supply change
- pool creation
- liquidity removal
- holder concentration change
- launchpad graduation
- launchpad migration
- token code change
- manual analyst request
- methodology version change.

The event producer supplies a stable event ID, target, source block, source block hash, ruleset
version, methodology version, and requester. The durable queue integration remains part of the
shared indexer-to-worker queue blocker.

## Analysis stages

### 1. Contract identity

- Runtime bytecode hash.
- Verified source and ABI.
- Constructor arguments.
- Creator and creation transaction.
- Contract age.
- Bytecode similarity to known contracts.
- Duplicate name/symbol addresses.
- Canonical Stock Token allowlist check.

### 2. Proxy analysis

Resolve:
- EIP-1967 implementation and admin slots;
- beacon proxies;
- transparent proxies;
- UUPS patterns;
- minimal clones;
- diamond proxy facets where detectable.

Findings:
- upgradeability;
- current admin;
- admin EOA vs multisig/timelock;
- unverified implementation;
- recent upgrade;
- implementation self-destruct or delegatecall hazards.

### 3. Privilege and source analysis

Parse verified Solidity AST when available. Supplement with selectors and bytecode heuristics.

Detect:
- mint or supply expansion;
- pause/unpause;
- blacklist/whitelist;
- forced transfer/confiscation;
- fee setters;
- maximum fee;
- fee destination;
- trading enable/disable;
- max transaction/wallet;
- exemptions;
- owner withdrawal;
- arbitrary external call/delegatecall;
- role administration;
- ownership renunciation claims;
- mutable router/pair;
- permit/domain issues;
- nonstandard transfer behavior.

### 4. Dynamic simulation

Fork Robinhood Chain at a fixed block using Anvil. Use disposable accounts.

Simulate:
- buy where liquidity exists;
- sell after buy;
- transfers between ordinary addresses;
- approval and transferFrom;
- zero-value and edge transfers;
- fee behavior;
- owner-only functions through eth_call state overrides only where safe;
- suspicious revert asymmetry;
- quote vs actual output.

Never send real funds for a scanner test.

### 5. Supply and holders

Calculate:
- top 1/5/10/20 concentration;
- deployer and related-wallet concentration;
- circulating supply;
- pool, burn, bridge, vesting, treasury, and contract exclusions;
- holder growth;
- wallet clustering;
- transfer concentration.

Every exclusion must be visible and versioned.

### 6. Liquidity

For each supported venue:
- pool existence;
- paired asset quality;
- current liquidity;
- liquidity-provider ownership;
- add/remove history;
- lock or vesting evidence;
- pool age;
- price impact at standard trade sizes;
- concentration across pools;
- abrupt liquidity movement.

Never call liquidity “locked” merely because LP tokens sit in a contract. Identify the lock contract, beneficiary, unlock time, and withdrawal conditions.

### 7. Deployer graph

- creator wallet history;
- funding source;
- sibling contracts;
- prior tokens;
- interactions with known malicious addresses;
- rapid deployment pattern;
- deployer token sales;
- role transfers;
- multisig/timelock adoption.

Labels from external vendors must identify their source and should not be treated as infallible.

## Rule categories

- Contract control
- Transfer behavior
- Supply
- Upgradeability
- Liquidity
- Holder distribution
- Deployer history
- Identity and impersonation
- Market integrity
- Oracle behavior
- Metadata quality
- Launchpad behavior

## Score methodology

Start at 100 and apply capped category penalties. Critical deterministic findings can cap the overall grade.

Suggested categories:
- contract control: 25
- transfer behavior: 20
- liquidity: 20
- supply/holders: 15
- deployer: 10
- identity: 5
- metadata/data completeness: 5

Example caps:
- sell simulation consistently fails: maximum score 20;
- unbounded owner mint: maximum score 30;
- arbitrary confiscation: maximum score 20;
- fake canonical Stock Token address: maximum score 10;
- unverified source alone: warning and completeness reduction, not automatic scam classification.

Version the weights. Persist old reports.

## AI explanation layer

Input only structured findings and evidence. Require the model to:
- summarize without adding facts;
- preserve uncertainty;
- avoid price predictions;
- cite finding IDs;
- say when data is missing.

Validate model output and show the deterministic report even when AI is unavailable.
