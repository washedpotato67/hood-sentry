#!/usr/bin/env sh
set -eu

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm --filter contracts forge:test
pnpm --filter contracts forge:coverage

echo "Release checks passed."
