# Prompt 01 — Foundation

Bootstrap the Hood Sentry monorepo according to `docs/REPOSITORY_STRUCTURE.md`.

Implement:
- pnpm workspace and Turborepo;
- strict shared TypeScript config;
- Biome or equivalent formatting/linting;
- Vitest;
- environment validation with Zod;
- structured logger with request IDs and secret redaction;
- OpenTelemetry hooks;
- Docker Compose for PostgreSQL and Redis;
- Fastify API skeleton;
- Next.js web skeleton;
- indexer and worker process skeletons;
- health/readiness endpoints;
- CI workflows for format, lint, typecheck, test, build, and security scanning;
- feature-flag package;
- `docs/IMPLEMENTATION_STATUS.md` updates.

Acceptance:
- one command installs dependencies;
- one command starts local infrastructure and all development services;
- clean clone passes format, lint, typecheck, test, and build;
- missing required environment variables fail at startup with safe errors;
- no service logs a secret;
- readiness reports dependency failures accurately.
