# Codex Repository Instructions

You are implementing Hood Sentry, a production-minded Robinhood Chain intelligence platform. Work as a senior TypeScript, Solidity, security, and infrastructure engineer.

## Operating rules

1. Read the relevant document in `/docs` before changing a subsystem.
2. Do not replace requested production behavior with mock data. Fixtures are allowed only in tests, Storybook, or an explicitly labelled demo mode.
3. Use strict TypeScript. Avoid `any`, unsafe casts, non-null assertions, and swallowed exceptions.
4. Validate all external input with Zod at service boundaries.
5. Use checksummed EVM addresses and normalize addresses to lowercase only for database identity keys.
6. Use decimal-safe integer arithmetic. Never use JavaScript floating-point math for token quantities, prices, balances, or P&L.
7. All chain writes require simulation, chain-ID validation, user-visible calldata intent, deadline protection, and explicit error handling.
8. Never hardcode an unverified third-party protocol address. Put addresses in versioned chain configuration with a source and verification date.
9. Never expose server secrets through `NEXT_PUBLIC_*`.
10. Never log private keys, access tokens, signed messages, raw session cookies, or full provider URLs containing API keys.
11. Every job must be idempotent and retry-safe.
12. Every indexed record must be traceable to chain ID, block number, block hash, transaction hash, and log index where applicable.
13. Store raw chain facts separately from derived analytics.
14. Risk scores must be explainable. Every rule produces evidence, severity, confidence, and a version.
15. AI output is commentary only. It cannot create, suppress, or change a risk finding.
16. Token, staking, bond, and reporting contracts must use OpenZeppelin primitives and Foundry tests.
17. The token must have no transfer tax, blacklist, anti-sell logic, rebasing, reflection, hidden mint, or owner-controlled confiscation.
18. Prefer immutable or versioned contracts over proxies. The token is never upgradeable.
19. Run formatting, linting, type checks, unit tests, integration tests, and contract tests before declaring a task complete.
20. Make small, coherent commits. Keep a running implementation log in `docs/IMPLEMENTATION_STATUS.md`.

## Required commands before completion

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm --filter contracts forge:test
pnpm --filter contracts forge:coverage
```

If a command does not exist yet, create it. If an external service prevents a test, provide a deterministic local substitute and document the missing live validation.

## Security stop conditions

Stop the affected write path and leave it disabled if any of these are true:

- contract tests or invariants fail;
- deployment addresses cannot be independently verified;
- RPC chain ID differs from configured chain ID;
- transaction simulation fails;
- oracle data is stale, paused, negative, or unavailable;
- sequencer status cannot be established for a price-sensitive contract;
- admin ownership is still on a personal EOA;
- contract source is not verified;
- a secret has entered git history;
- database migrations cannot be applied on a clean database.
