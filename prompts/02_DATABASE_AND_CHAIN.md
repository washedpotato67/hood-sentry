# Prompt 02 — Database and Chain Layer

Implement the database and Robinhood Chain packages.

Use `docs/DATA_MODEL.md` as the source of truth. Create migrations, repositories, and test fixtures. Add Robinhood mainnet/testnet Viem chain definitions, provider pooling, health checks, chain-ID verification, and Blockscout enrichment client.

Requirements:
- numeric-safe token amounts;
- normalized address keys plus checksummed display;
- raw blocks, transactions, logs, checkpoints;
- contracts, tokens, transfers, pools, swaps, metrics;
- risk, wallet, auth, alerts, projects, reports, audit logs;
- idempotent repositories;
- transaction boundaries;
- provider circuit breaker;
- primary/secondary RPC;
- no production dependency on public RPC;
- verified chain configuration metadata.

Acceptance:
- migrations apply to a blank DB;
- repository integration tests pass;
- chain client rejects wrong chain ID;
- failover is tested;
- address and bigint serialization are tested;
- no floating-point financial fields exist.
