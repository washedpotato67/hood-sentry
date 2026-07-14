# Backfill and coverage boundaries

Status: blocked for production execution.

Robinhood Chain mainnet is chain ID 4663. The indexer supports bounded historical mode, resumable checkpoints, gap repair, reorg rollback, provider failover, archive-provider selection, and malformed-log isolation. Production backfill did not run during the 2026-07-14 launch audit because no managed archive RPC, PostgreSQL instance, official launchpad registry, official Stock Token registry snapshot, application launch block, or official `$SENTRY` address was supplied.

Earliest required blocks remain unresolved for token discovery, pools, launchpads, Stock Tokens, wallet history, project contracts, `$SENTRY`, and the application launch date. Using block zero without a capacity plan is prohibited. Each boundary must come from a verified deployment or product event and must record its source.

Before launch, record per-domain start blocks, run controlled ranges, cap concurrency and request rate, persist checkpoints, quarantine errors, scan gaps, and compare canonical logs against direct chain state. Publish the earliest indexed block and incomplete-history warnings on every affected API and page.

Completion evidence must include zero unexplained gaps, zero duplicate canonical logs, the expected checkpoint, verified registries, the official `$SENTRY` record, risk completeness, and measured indexer lag.
