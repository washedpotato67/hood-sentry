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

### 0. Fork-based dynamic simulation

`DynamicSimulationService` starts Anvil with a Robinhood Chain RPC fork and a fixed block number.
The process uses only locally generated Anvil accounts. `ProcessAnvilForkLauncher` never exposes a
mainnet transaction method. `AnvilJsonRpcSimulationProvider` sends calls and transactions only to
the local Anvil endpoint, snapshots before each transaction, records receipt and probe changes, and
reverts the snapshot after execution.

Every execution preserves the fork configuration, source block and hash, target, sender, calldata,
route, expected and actual output, revert data, decoded error, gas, fee, balance changes, allowance
changes, warnings, and hypothetical-state status. Unverified routes fail before execution.
Timeouts quarantine the batch. A cancellation returns completed executions as partial evidence.

Simulation findings compare buy and sell paths, ordinary transfers, expected and actual output,
effective fees, address-dependent behavior, and unexpected asset changes. A finding reports
simulation evidence and never describes a fork result as a broadcast transaction.

### 1. Holder, liquidity, and relationship intelligence

`analyzeHolders` calculates raw and adjusted concentration, Gini, supply allocations, and visible exclusions with bigint arithmetic. Contract addresses stay included until an independently verified classification excludes them. Rebase uncertainty and incomplete history produce explicit warnings.

`analyzeLiquidityRisk` keeps unsupported protocols and unverified lock claims in an unknown state. Ownership evidence, lock beneficiary, unlock data, removals, provider concentration, and migration destinations remain attached to the result.

`buildRelationshipGraph` traverses chain-evidenced edges with depth and edge limits. External labels retain provider attribution and do not create identity claims on their own.

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

`ProxyAnalyzer` reads the EIP-1967 implementation, admin, and beacon slots from the shared resilient
RPC client at the scan block. Direct storage values define the current implementation, beacon, and
admin. Blockscout metadata stays in a separate attributed comparison record.

The analyzer recognizes transparent proxies, UUPS proxies through `proxiableUUID`, beacon proxies,
supported EIP-1167 runtime templates, clone-factory selectors, nested proxy layers, common diamond
loupe and cut surfaces, and otherwise unknown delegatecall proxies. Unknown delegatecall behavior
stays unknown instead of receiving a known proxy label.

Authority resolution checks runtime code, `owner()`, Safe owners and threshold, and timelock minimum
delay at the pinned block. A ProxyAdmin or beacon owner is followed to its current controller. An
empty code response identifies an EOA. No address label or explorer claim establishes Safe,
timelock, owner, or EOA status.

Every proxy result preserves:

- all three storage slot keys and raw values
- resolved addresses and implementation code hash
- each nested layer
- current authority classification
- recent `Upgraded`, `AdminChanged`, `BeaconUpgraded`, and `DiamondCut` events
- source-verification attribution
- initialization evidence
- explorer conflicts and data-quality warnings.

Upgradeability produces an informational warning with zero score penalty. Separate rules cover EOA
control, missing timelock evidence, unverified or empty implementations, recent upgrades,
initialization hazards, unsupported delegatecall behavior, nested complexity, and metadata
disagreement.

### 3. Privilege and source analysis

`ContractPrivilegeAnalyzer` tokenizes verified Solidity source and builds a deterministic structural
AST for contracts, inheritance, modifiers, functions, state variables, source paths, and line
numbers. When Blockscout identifies the compiled contract, analysis follows only the selected
contract and its source inheritance closure. Source files retain provider, fetch time, and source
hash attribution.

`PrivilegeStateReader` reads `owner()` and enumerable AccessControl role members at the source
block. Indexed role-event candidates are supported through `hasRole` when role enumeration is not
available. Each controller receives direct EOA, Safe, timelock, contract, renounced, or unknown
classification.

Each capability record contains the function, selector, role, current controllers, source-level
bounds, timelock, multisig, EOA, renounced state, evidence, and explicit confidence. Renounced
ownership does not suppress active non-owner roles.

When verified source is absent, the analyzer uses a validated ABI when available. With neither
source nor ABI, it scans EVM instructions for supported `PUSH4` selectors while skipping push data.
ABI conclusions use medium confidence. Bytecode-selector conclusions use low confidence and state
that selectors do not prove behavior or authorization.

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

`ContractAnalysisContextLoader` composes chain storage, runtime bytecode, Blockscout source, current
role state, proxy output, and privilege output into one pinned `RiskScanContext`. Blockscout outage
returns unavailable source attribution while chain analysis and scan execution continue.

To add a capability rule:

1. Add the normalized capability to `PrivilegeCapability`.
2. Add a source matcher tied to parsed function or state evidence.
3. Add ABI and selector evidence only when the signature is stable enough for reduced-confidence
   reporting.
4. Add the capability to `createPrivilegeAnalysisRules` with a category and integer penalty.
5. Add a Solidity fixture and tests for controller, bound, and confidence behavior.

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
