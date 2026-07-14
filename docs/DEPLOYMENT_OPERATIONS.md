# Deployment and Operations

## Fast production topology

### Edge and web
- Cloudflare DNS, WAF, bot/rate controls.
- Vercel for Next.js web.
- Preview deployments use isolated test credentials and testnet only.

### Stateful services
- Railway for Fastify API, indexer, worker, Telegram bot.
- Managed PostgreSQL with point-in-time recovery.
- Managed Redis for BullMQ.
- Cloudflare R2 or S3-compatible storage for project metadata and report evidence.

### Chain infrastructure
- Alchemy mainnet archive RPC and WebSocket as primary.
- QuickNode or another separately operated provider as secondary.
- Public Robinhood RPC only as development/emergency fallback.

### Observability
- OpenTelemetry traces.
- Structured JSON logs.
- Error reporting.
- Metrics and dashboards.
- External uptime checks.
- Pager notifications for critical alerts.

## Environments

- `local`: Anvil/fork, Docker Postgres/Redis.
- `test`: Robinhood testnet.
- `staging`: testnet with production-like cloud services.
- `production`: Robinhood mainnet.

No production secret is copied to preview or staging.

## Required dashboards

- API latency/error rate.
- Indexer head vs chain head.
- Last successfully indexed block.
- Reorg count.
- Queue depth, age, retries, dead letters.
- RPC latency/error/block lag.
- Risk scans queued/completed/failed.
- Alert evaluation and delivery latency.
- Webhook success rate.
- Database connections, locks, storage, replication/PITR.
- Contract balances and paused states.
- Gas sponsorship spend.

## Backups

- Automated daily backups and PITR.
- Quarterly restore test; for launch, perform at least one restore test.
- Export deployment manifests, contract ABIs, verified source, and configuration to git and encrypted offline storage.
- Redis is rebuildable; do not treat it as backup.

## Release process

1. CI passes.
2. Database migration tested on a copy.
3. Deploy API/workers with backwards-compatible schema.
4. Run smoke tests.
5. Deploy web.
6. Enable feature flag for internal wallet.
7. Enable small public cohort.
8. Observe metrics.
9. Expand.
10. Record release and rollback point.

## Rollback

- Web/API: previous immutable deployment.
- Database: forward-fix preferred; reversible migration where safe.
- Indexer: stop, restore checkpoint, replay raw facts.
- Contracts: pause affected module; immutable token cannot be rolled back.
- Feature flags: immediate transactional kill switch.

## Health endpoints

- `/health/live`
- `/health/ready`
- `/health/dependencies`
- `/metrics` protected

Readiness checks DB, Redis, provider chain ID, and block lag. A secondary-provider outage may degrade readiness but should not necessarily kill the service.

## Domain and security setup

- HSTS.
- CSP with nonce.
- no wildcard CORS.
- production cookie domain and secure flags.
- DNSSEC where supported.
- DMARC, DKIM, SPF for email.
- separate notification subdomain.
- status page.
