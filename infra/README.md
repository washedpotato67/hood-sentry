# Deployment infrastructure

Environments use isolated credentials for local, test, staging, and production. Production writes remain disabled until mainnet-write approval is recorded.

Topology: Cloudflare DNS/WAF, Netlify web, Railway or equivalent API/indexer/worker/bot, managed PostgreSQL with PITR, managed Redis, object storage, primary RPC, and independent secondary RPC.

Required release sequence: format, lint, typecheck, unit tests, integration tests, E2E, security scans, build, staging deploy, smoke test, manual production approval, production deploy, post-deploy smoke test.

Preview deployments use testnet credentials only. Failed smoke tests stop rollout. Use immutable image or commit references, migration locks, readiness checks, resource limits, and rollback to the previous immutable release.
