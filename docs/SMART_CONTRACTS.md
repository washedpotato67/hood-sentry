# Smart Contract Specification

Use Solidity, Foundry, OpenZeppelin, and explicit deployment scripts. Default to non-upgradeable, versioned contracts.

## Administrative topology

```text
Deploy key (temporary hardware wallet)
        |
Transfers all roles after deployment
        v
Safe multisig (operations)
        |
TimelockController (48h+ for sensitive changes)
        |
Project contracts
```

No production admin role remains on a personal EOA.

## `SentryToken.sol`

Properties:
- ERC-20
- fixed supply minted once at deployment
- ERC20Permit
- ERC20Votes only if governance is genuinely intended
- no further minting
- no transfer tax
- no blacklist
- no pause
- no confiscation
- no anti-bot transfer restrictions
- no rebasing/reflection
- token contract is not upgradeable

Constructor inputs:
- name
- symbol
- initial recipient
- total supply

Recommended deployment flow:
- mint to `TokenDistributionVault`;
- fund vesting, community, treasury, and liquidity allocations from documented distribution transactions;
- publish allocation addresses and transaction hashes.

Do not hardcode tokenomics until the final allocation table is approved. A reasonable starting model is:
- 40% ecosystem/community;
- 20% initial and future liquidity;
- 20% treasury;
- 15% team with 12-month cliff and 36-month linear vesting;
- 5% partners/early contributors with vesting.

This is a product recommendation, not a promise of token value.

## `AccessStaking.sol`

Purpose: lock tokens to unlock product tiers. It pays no yield.

Functions:
- `stake(uint256 amount)`
- `requestUnstake(uint256 amount)`
- `cancelUnstake(uint256 requestId)`
- `withdraw(uint256 requestId)`
- `stakeOf(address)`
- `tierOf(address)`

Requirements:
- `SafeERC20`
- `ReentrancyGuard`
- pause deposits and new requests in emergencies;
- withdrawals remain available or have a documented emergency exit;
- configurable tier thresholds only through timelock;
- unstake cooldown;
- no admin seizure;
- no reward accounting;
- events for every transition.

## `ProjectRegistry.sol`

Stores minimal authoritative data:
- project ID;
- owner/operator wallet;
- metadata content hash and URI;
- verified contract addresses;
- profile status;
- version counter.

Functions:
- create/claim via EIP-712 authorization;
- add/remove operator;
- propose and finalize metadata update;
- add/remove contract;
- suspend only through documented moderation role;
- migrate ownership.

Large metadata remains offchain in content-addressed storage. Store hash onchain.

## `ProjectBondVault.sol`

- accepts Sentry token bonds;
- maps bond to project;
- supports top-up;
- withdrawal request with delay;
- dispute freeze;
- objective slash reason codes;
- slashing callable only by timelocked resolver role;
- slash destination is treasury or community pool, never an arbitrary caller;
- no automatic AI or vote-based slashing.

## `ReportRegistry.sol`

Stores:
- report ID;
- subject type/address;
- reason code;
- evidence hash/URI;
- reporter;
- reporter bond;
- status;
- resolution code;
- appeal status.

State machine:
`SUBMITTED -> UNDER_REVIEW -> UPHELD | REJECTED -> APPEALED -> FINAL`

Rules:
- reporter bond is returned when upheld;
- spam/malicious reporter bond may be partially slashed under objective policy;
- project bond action is separate;
- admin resolution passes through multisig/timelock policy;
- evidence must never contain private personal data onchain.

## `VestingFactory.sol`

Use OpenZeppelin VestingWallet or clones:
- beneficiary;
- start;
- duration;
- cliff extension if implemented and tested;
- revocable only if explicitly disclosed; default non-revocable.

## `TokenDistributionVault.sol`

- holds allocation inventory;
- only executes documented distributions;
- role controlled by Safe;
- optional Merkle distributor for claims;
- allocation cap invariants.

## Optional `FeeCollector.sol`

Only needed when onchain protocol fees exist. UI referral revenue does not require it.

- accepted tokens allowlist;
- withdrawals only to treasury Safe;
- no arbitrary call;
- transparent events;
- timelocked configuration.

## Upgrade policy

Preferred:
- token immutable;
- staking, registry, bonds, and reports are non-upgradeable;
- deploy V2 and migrate through explicit user action.

If a proxy is unavoidable:
- UUPS or transparent proxy;
- implementation initializer disabled;
- upgrade authorization only TimelockController;
- storage-layout checks in CI;
- minimum 48-hour delay;
- public upgrade announcement;
- emergency pause cannot perform an upgrade.

## Tests

Unit:
- every state transition;
- access control;
- boundary amounts;
- cooldowns;
- replay protection;
- pause behavior;
- malicious ERC-20 behavior;
- reentrancy attempts.

Fuzz:
- arbitrary stake/request/withdraw sequences;
- bond conservation;
- allocation conservation;
- role changes;
- report state machine.

Invariants:
- total token supply never changes;
- vault liabilities never exceed balance;
- users cannot withdraw more than staked;
- resolved reports cannot return to mutable states;
- only authorized roles change configuration;
- paused contracts preserve user exit path.

Tools:
- Forge tests and coverage;
- Slither;
- Aderyn;
- Echidna or Foundry invariant testing;
- storage-layout diff if proxies exist.

## Deployment gates

- tests and invariants pass;
- static analyzers reviewed;
- compiler and optimizer pinned;
- deterministic deployment artifacts saved;
- testnet deployment exercised;
- roles transferred to Safe/timelock;
- source verified;
- deployment manifest signed and committed;
- feature flag remains off until the frontend reads the exact deployed address and bytecode hash.
