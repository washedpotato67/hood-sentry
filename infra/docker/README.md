# Docker images

The repository ships production images for each runtime:

- `Dockerfile.api` runs the Fastify API on port 4000.
- `Dockerfile.indexer` runs the canonical chain indexer.
- `Dockerfile.worker` runs BullMQ analytics and notification jobs.
- `Dockerfile.telegram-bot` runs Telegram long polling.
- `Dockerfile.admin` runs the audited admin role CLI.
- `Dockerfile.web` runs the Next.js standalone server on port 3000.

All images use Node 20.20.2 on Alpine 3.22, pnpm 9.15.4, the frozen lockfile, and a non-root runtime user.

## Local product stack

```bash
pnpm env:init
# Add ALCHEMY_API_KEY and any optional provider keys to .env.
docker compose --profile product up --build
```

Add `--profile notifications` when `TELEGRAM_BOT_TOKEN` exists. Add `--profile admin` only for an explicit admin CLI command.

The product profile applies all migrations before starting the API, indexer, worker, and web services. PostgreSQL and Redis use persistent local volumes.

