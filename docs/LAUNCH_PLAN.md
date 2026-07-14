# Launch Plan — July 13–14, 2026 WAT

The full architecture is included. The execution order below protects dependencies. Build modules in this order even when multiple Codex sessions run in parallel.

## Monday, July 13

### Track A — foundation
- Bootstrap monorepo.
- Environment validation.
- Docker Postgres/Redis.
- Chain client and Robinhood configuration.
- CI and code-quality commands.
- Database schema and migrations.

### Track B — contracts
- Implement token, staking, registry, bond, report, vesting, and deployment scripts.
- Unit, fuzz, and invariant tests.
- Testnet deployment rehearsal.
- Safe/timelock setup.

### Track C — ingestion
- Live block/log indexer.
- checkpointing and reorg handling.
- ERC-20 transfers.
- contract/token discovery.
- supported DEX pool and swap adapters.
- Blockscout enrichment.

### Track D — frontend shell
- design system;
- navigation;
- search;
- discover;
- token;
- wallet;
- alerts;
- project;
- staking;
- report;
- transaction-review components.

## Tuesday, July 14

### Morning
- Contract scanner and risk rules.
- holder and liquidity analysis.
- token metrics and trending.
- wallet balances, approvals, and P&L.
- Stock Token multiplier/oracle module.
- SIWE.

### Afternoon
- alert engine and Telegram/webhook delivery.
- project claiming and profiles.
- report workflow.
- access staking frontend.
- quote/trade adapter.
- API key foundations.
- AI finding summary behind a flag.

### Evening
- staging/mainnet smoke tests.
- contract verification and role transfer.
- production deployment.
- launch data backfill.
- legal/methodology pages.
- security review.
- enable public read paths.
- enable each write feature only after its explicit gate.
- publish before 23:59 WAT.

## Parallel-work protocol

Create independent Codex worktrees/branches:
- `foundation`
- `contracts`
- `indexer`
- `risk`
- `web`
- `alerts`
- `deployment`

Each branch must respect package boundaries. Merge foundation first, then contracts/indexer, then feature branches.

## Non-negotiable launch checks

- No private keys in repository or Codex transcript.
- Production uses managed RPC, not public RPC.
- Chain ID validated.
- Indexer lag visible.
- Risk unknowns visible.
- Contract source verified.
- Admin roles on Safe/timelock.
- Token supply and allocations reconcile.
- Small real swap round trip tested.
- Alerts tested.
- Backups and rollback tested.
- Transaction flags can be disabled immediately.
