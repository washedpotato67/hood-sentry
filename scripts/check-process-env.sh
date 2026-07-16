#!/bin/bash
# Check that process.env is not accessed outside packages/config
# This enforces the single configuration system requirement

set -e

echo "Checking for unauthorized process.env access..."

# Find all TypeScript files that access process.env, excluding:
# - packages/config (allowed to access process.env)
# - node_modules
# - dist directories
# - test files (may need to set process.env for testing)
# - build/test tooling config, which runs outside the app runtime and before
#   getEnv() is loadable (drizzle, next, playwright)
#
# apps/web is exempted by exact path only, never as a directory. Importing
# @hood-sentry/config into web would pull server-env Zod validation into the
# client bundle, so these two read process.env directly:
# - src/lib/api.ts: server-only, guarded by `typeof window !== 'undefined'`
# - src/middleware.ts: NODE_ENV, a build constant Next.js inlines
# Anything else under apps/web must still use getEnv().

VIOLATIONS=$(grep -r "process\.env" \
  --include="*.ts" \
  --include="*.tsx" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.next \
  --exclude-dir=out \
  --exclude-dir=coverage \
  . \
  | grep -v "^./packages/config/" \
  | grep -v "__tests__" \
  | grep -v "\.test\.ts" \
  | grep -v "migrate\.ts" \
  | grep -v "migrate-reset\.ts" \
  | grep -v "drizzle\.config\.ts" \
  | grep -v "^\./apps/web/next\.config\.ts:" \
  | grep -v "^\./apps/e2e/playwright\.config\.ts:" \
  | grep -v "^\./apps/web/src/lib/api\.ts:" \
  | grep -v "^\./apps/web/src/middleware\.ts:" \
  || true)

if [ -n "$VIOLATIONS" ]; then
  echo "❌ ERROR: Found unauthorized process.env access outside packages/config:"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  echo "Only packages/config may access process.env directly."
  echo "Use getEnv() from @hood-sentry/config instead."
  exit 1
fi

echo "✓ No unauthorized process.env access found"
