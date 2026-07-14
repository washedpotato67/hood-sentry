# Deterministic Risk Engine

## Principle

A score is a summary, not evidence. The product must show findings first and score second.

Each rule returns:

```ts
type RiskFinding = {
  ruleId: string;
  ruleVersion: string;
  status: "pass" | "warn" | "fail" | "unknown";
  severity: "info" | "low" | "medium" | "high" | "critical";
  confidence: number;
  title: string;
  explanation: string;
  evidence: Evidence[];
  remediation?: string;
  sourceBlock: bigint;
};
```

Unknown is not pass. Missing source, unavailable simulation, or inaccessible holder data reduces completeness.

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
- Identity/impersonation
- Market integrity
- Oracle and RWA behavior
- Metadata quality

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
