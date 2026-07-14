# Repository Structure

```text
hood-sentry/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── .env.example
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── contracts.yml
│       ├── security.yml
│       └── deploy.yml
├── apps/
│   ├── web/
│   ├── api/
│   ├── indexer/
│   ├── worker/
│   ├── telegram-bot/
│   └── admin/
├── packages/
│   ├── chain/
│   │   ├── clients/
│   │   ├── config/
│   │   ├── abis/
│   │   └── protocols/
│   ├── contracts/
│   │   ├── src/
│   │   ├── script/
│   │   ├── test/
│   │   └── deployments/
│   ├── db/
│   │   ├── schema/
│   │   ├── migrations/
│   │   └── repositories/
│   ├── risk-engine/
│   │   ├── rules/
│   │   ├── analyzers/
│   │   ├── scoring/
│   │   └── fixtures/
│   ├── portfolio-engine/
│   ├── alert-engine/
│   ├── auth/
│   ├── api-contracts/
│   ├── shared/
│   ├── ui/
│   ├── observability/
│   └── config/
├── infra/
│   ├── docker/
│   ├── railway/
│   ├── vercel/
│   ├── cloudflare/
│   └── runbooks/
├── docs/
└── prompts/
```

## Package boundaries

- `chain`: RPC clients, chain definitions, verified addresses, ABI adapters.
- `db`: schema and repository layer; no HTTP or UI imports.
- `risk-engine`: pure or deterministic analysis functions plus explicit adapters.
- `portfolio-engine`: cost basis and P&L algorithms using integer arithmetic.
- `alert-engine`: rule evaluation and delivery-agnostic events.
- `api-contracts`: Zod request/response schemas shared by API and web.
- `shared`: narrow primitives only; do not turn it into a dumping ground.
- `observability`: logger, tracing, metrics, error normalization.
- `config`: validated environment loading.

## Dependency direction

```text
apps -> packages
risk-engine -> chain types, db interfaces, shared
portfolio-engine -> db interfaces, shared
alert-engine -> db interfaces, shared
db -> shared
chain -> shared
shared -> nothing internal
```

Circular dependencies are prohibited.
