# Local Development Setup

## Prerequisites

- Node.js >= 20.11.0
- pnpm >= 9.0.0
- Docker and Docker Compose
- Foundry (for smart contract development)

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd sentry

# 2. Install dependencies
pnpm install

# 3. Start local infrastructure (PostgreSQL + Redis)
pnpm docker:up

# 4. Copy environment template
cp .env.example .env

# 5. Edit .env with your local values
# Required: DATABASE_URL, REDIS_URL, RPC URLs, SESSION_SECRET

# 6. Run database migrations
pnpm db:migrate

# 7. Start all development services
pnpm dev
```

## One-Command Setup

```bash
pnpm setup
```

This runs: `pnpm install && pnpm docker:up && pnpm db:migrate`

## Development Services

| Service | Port | URL |
|---------|------|-----|
| Next.js Web | 3000 | http://localhost:3000 |
| Fastify API | 4000 | http://localhost:4000 |
| PostgreSQL | 5432 | postgresql://localhost:5432/hood_sentry |
| Redis | 6379 | redis://localhost:6379 |

## Useful Commands

```bash
# Start all services
pnpm dev

# Build all packages
pnpm build

# Run all tests
pnpm test

# Run type checking
pnpm typecheck

# Run linting
pnpm lint

# Auto-fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check

# Run database migrations
pnpm db:migrate

# Seed database with test data
pnpm db:seed

# Reset database
pnpm db:reset

# Run contract tests
pnpm contracts:test

# Run contract coverage
pnpm contracts:coverage

# View Docker logs
pnpm docker:logs

# Stop Docker services
pnpm docker:down

# Clean all build artifacts
pnpm clean
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `ROBINHOOD_MAINNET_RPC_URL` - Robinhood Chain mainnet RPC (use Alchemy for production)
- `ROBINHOOD_TESTNET_RPC_URL` - Robinhood Chain testnet RPC
- `SESSION_SECRET` - Random 64-character string for session encryption
- `SIWE_DOMAIN` - Domain for Sign-In with Ethereum (e.g., `localhost:3000`)
- `SIWE_ORIGIN` - Origin URL for SIWE (e.g., `http://localhost:3000`)

## Testing

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm test:unit

# Run integration tests (requires Docker)
pnpm test:integration

# Run contract tests
pnpm contracts:test
```

## Troubleshooting

### Docker services won't start

```bash
# Check if ports are in use
lsof -i :5432
lsof -i :6379

# Restart Docker services
pnpm docker:down
pnpm docker:up
```

### Database connection errors

```bash
# Verify PostgreSQL is running
docker compose ps postgres

# Check logs
docker compose logs postgres

# Reset database
pnpm db:reset
```

### TypeScript errors

```bash
# Rebuild all packages
pnpm clean
pnpm install
pnpm build
```

## Feature Flags

All transactional features are disabled by default. Enable them in the database or through the admin API:

- `TRADING_ENABLED`
- `TOKEN_STAKING_ENABLED`
- `PROJECT_BONDS_ENABLED`
- `REPORT_BONDS_ENABLED`
- `ADMIN_SLASHING_ENABLED`
- `GAS_SPONSORSHIP_ENABLED`
- `AI_EXPLANATIONS_ENABLED`
- `WEBHOOKS_ENABLED`
- `STOCK_TOKEN_MODULE_ENABLED`
- `MAINNET_WRITES_ENABLED`

## Security Notes

- Never commit `.env` files
- Never log private keys, API secrets, or session tokens
- Use checksummed addresses for display, lowercase for database keys
- Validate chain ID before every chain operation
- All write transactions require simulation and user confirmation
