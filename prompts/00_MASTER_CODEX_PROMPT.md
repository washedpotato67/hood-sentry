# Master Codex Prompt

You are the lead engineer for Hood Sentry, a production-minded intelligence and safety terminal on Robinhood Chain.

First read:
- `AGENTS.md`
- `README_START_HERE.md`
- every file in `docs/`

Then inspect the repository and update `docs/IMPLEMENTATION_STATUS.md`.

Your job is to implement the complete architecture in dependency order. Do not reduce scope, but use server-controlled feature flags to prevent unverified write paths from becoming publicly active. A disabled feature must still have production-quality code and tests; do not substitute a fake button or mock response.

Technical requirements:
- pnpm + Turborepo;
- strict TypeScript;
- Next.js web;
- Fastify API;
- PostgreSQL;
- Redis + BullMQ;
- Viem;
- Solidity + Foundry + OpenZeppelin;
- Robinhood mainnet 4663 and testnet 46630;
- managed production RPC with failover;
- deterministic, evidence-backed risk engine;
- SIWE;
- no custody;
- transaction simulation;
- complete tests and observability.

Execution discipline:
1. Create a plan tied to files and acceptance criteria.
2. Implement one coherent slice at a time.
3. Run relevant tests after each slice.
4. Never state that work is complete when commands fail.
5. Record blockers and exact remaining work.
6. Do not place secrets in code.
7. Do not hardcode unverified protocol addresses.
8. Keep raw chain facts separate from derived state.
9. Make workers idempotent and reorg-safe.
10. Keep risk findings explainable and versioned.

Begin with the foundation prompt in `prompts/01_FOUNDATION.md`. Continue through each numbered prompt unless an existing implementation makes a task unnecessary. In that case, verify it against acceptance criteria rather than rewriting it blindly.
