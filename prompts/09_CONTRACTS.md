# Prompt 09 — Contracts

Implement every contract in `docs/SMART_CONTRACTS.md` with Foundry and OpenZeppelin.

Contracts:
- `SentryToken`;
- `TokenDistributionVault`;
- vesting/factory;
- `AccessStaking`;
- `ProjectRegistry`;
- `ProjectBondVault`;
- `ReportRegistry`;
- `TimelockController` deployment/configuration;
- optional `FeeCollector` only if product fees require it.

Create:
- deployment scripts for testnet and mainnet;
- configuration validation;
- deployment manifests;
- source verification commands;
- role-transfer scripts;
- unit, fuzz, and invariant tests;
- Slither/Aderyn configuration.

Acceptance:
- fixed supply invariant;
- no hidden mint/tax/blacklist/pause in token;
- vault solvency and conservation invariants;
- staking withdrawal/exit path;
- EIP-712 replay protection;
- report state-machine invariants;
- admin roles end on Safe/timelock;
- testnet rehearsal can be repeated from scripts.
