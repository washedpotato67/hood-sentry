# Railway services

Create four Railway services from the same repository. Set each service's config file path in Railway:

| Service | Config path | Runtime |
| --- | --- | --- |
| API | `/infra/railway/api.railway.json` | Fastify and database migrations |
| Indexer | `/infra/railway/indexer.railway.json` | Canonical chain ingestion |
| Worker | `/infra/railway/worker.railway.json` | Analytics, alerts, and notifications |
| Telegram bot | `/infra/railway/telegram-bot.railway.json` | Telegram polling |

Provision managed PostgreSQL and Redis in the same Railway project. Share `DATABASE_URL`, `REDIS_URL`, chain configuration, provider keys, and application configuration with the API, indexer, and worker. Set `SENTRY_API_INTERNAL_URL` on the Telegram service to the API's private Railway URL.

The API config runs `node packages/db/dist/migrate.js` before deployment and checks `/health/ready` before promotion. Background services use restart and drain policies but expose no public domains.

Use separate Railway environments for testnet staging and mainnet production. Keep `MAINNET_WRITES_ENABLED=false` until the release gate records verified addresses, simulation evidence, and an approved rollback point.

