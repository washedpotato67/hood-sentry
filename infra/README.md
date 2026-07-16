# Deployment infrastructure

Hood Sentry uses Cloudflare for DNS and edge controls, Vercel for Next.js, Railway for API and background services, managed PostgreSQL with point-in-time recovery, managed Redis, S3-compatible evidence storage, and two independently operated RPC providers.

The repository includes:

- six verified Docker image recipes in `infra/docker`
- four Railway config-as-code files in `infra/railway`
- root `vercel.json`
- a full local product Compose profile
- `infra/release.sh` for the complete local release gate
- `infra/smoke-test.sh` for post-deployment API and web checks

Run the local stack:

```bash
pnpm env:init
# Add provider API keys to .env.
docker compose --profile product up --build
```

Run Telegram polling when its key exists:

```bash
docker compose --profile product --profile notifications up --build
```

Run all release checks:

```bash
pnpm release:check
```

Check a deployed environment:

```bash
pnpm smoke -- https://app.example.com https://api.example.com
```

Use immutable deployment revisions, migration locks, readiness checks, resource limits, managed backups, restore tests, and a recorded rollback revision. Preview and staging environments use Robinhood Chain testnet only.

