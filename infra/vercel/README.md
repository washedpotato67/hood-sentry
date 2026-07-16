# Vercel web deployment

Import the repository as one Vercel project with the repository root selected. Root `vercel.json` installs the frozen pnpm graph, builds `@hood-sentry/web`, and serves `apps/web/.next` as Next.js output.

Set these web environment values:

- `SENTRY_API_INTERNAL_URL` points to the public HTTPS API origin.
- `NEXT_PUBLIC_ROBINHOOD_CHAIN_ID` is `46630` for staging or `4663` for production.

Do not place database, RPC, provider, session, or signing secrets in `NEXT_PUBLIC_*` values.

Preview deployments must use testnet and an isolated API environment. Production uses the approved domain after API readiness passes.

