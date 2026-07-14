# Prompt 04 — Risk Engine

Implement `packages/risk-engine` and worker integration according to `docs/RISK_ENGINE.md`.

Build:
- scan orchestration and versioning;
- verified-source and ABI retrieval;
- runtime-bytecode fingerprinting;
- EIP-1967/beacon/minimal-proxy resolution;
- ownership and role inspection;
- Solidity AST rules;
- selector/bytecode heuristic rules;
- Anvil fork simulation harness;
- buy/sell/transfer simulation where possible;
- holder concentration and exclusions;
- liquidity analysis;
- deployer graph;
- duplicate-symbol and canonical-asset impersonation rules;
- deterministic scoring;
- completeness;
- evidence serialization;
- API response model.

Do not use an LLM to generate findings or scores.

Acceptance:
- golden fixtures cover safe token, mintable token, pausable token, blacklist token, honeypot, proxy, concentrated supply, removable liquidity, and fake stock ticker;
- every finding has evidence and version;
- unknown data reduces completeness;
- identical input at identical block produces identical output;
- scanner timeouts quarantine expensive targets;
- risk endpoint returns historical report versions.
