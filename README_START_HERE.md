# Hood Sentry — Codex Build Pack

Hood Sentry is an explainable discovery, risk-analysis, portfolio, alerting, project-verification, and token-access platform for Robinhood Chain.

## Launch target

Public launch cutoff: **Tuesday, July 14, 2026 at 23:59 Africa/Lagos (WAT)**.

This repository pack describes the complete system. It does not pretend that every feature can be safely activated merely because its code compiles. Build every module, but put all high-risk or incompletely tested write paths behind feature flags. The public product can expose a complete read-only experience while contracts and transactional features pass their gates.

## Read in this order

1. `docs/PRD.md`
2. `docs/ARCHITECTURE.md`
3. `docs/REPOSITORY_STRUCTURE.md`
4. `docs/DATA_MODEL.md`
5. `docs/API_SPEC.md`
6. `docs/RISK_ENGINE.md`
7. `docs/SMART_CONTRACTS.md`
8. `docs/SECURITY_THREAT_MODEL.md`
9. `docs/UI_UX.md`
10. `docs/PRICING_AND_MARKET_METRICS.md`
11. `docs/DISCOVERY_AND_TRENDING.md`
12. `docs/DEPLOYMENT_OPERATIONS.md`
13. `docs/TOKEN_LAUNCH_RUNBOOK.md`
14. `docs/LAUNCH_PLAN.md`
15. `AGENTS.md`
16. `prompts/00_MASTER_CODEX_PROMPT.md`

## Core technical choices

- TypeScript throughout offchain services.
- Solidity and Foundry for contracts.
- pnpm + Turborepo monorepo.
- Next.js web application.
- Fastify API.
- PostgreSQL as the source of derived application state.
- Redis + BullMQ for jobs.
- Viem for EVM access.
- Alchemy production RPC/WebSocket; secondary provider for failover.
- Blockscout used for enrichment and verification, never as the sole canonical data source.
- OpenZeppelin contracts.
- Cloudflare + Vercel + Railway for the fastest credible launch topology.
- Deterministic risk rules first; AI may summarize findings but must never invent or alter a score.

## Robinhood Chain constants

- Mainnet chain ID: `4663`
- Testnet chain ID: `46630`
- Native gas token: `ETH`
- Mainnet public RPC: `https://rpc.mainnet.chain.robinhood.com`
- Testnet public RPC: `https://rpc.testnet.chain.robinhood.com`
- Mainnet explorer: `https://robinhoodchain.blockscout.com`
- Mainnet WETH: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
- Mainnet USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

Public RPC endpoints are rate-limited and are not production infrastructure. Use a paid or managed RPC for production.

## Definition of done

A feature is not done until:

- its acceptance criteria pass;
- its tests pass;
- errors are observable;
- security-sensitive inputs are validated;
- no secret is present in source, logs, or client bundles;
- migrations are reversible or have a documented recovery path;
- write paths are simulated before transaction submission;
- user-facing failures are explicit rather than silently swallowed.
