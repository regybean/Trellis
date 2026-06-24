#!/usr/bin/env bash
# Bring up the full infra rig and wait until healthy, then seed localstripe.
# infra.sh resolves + env-gates the profiles; `up --wait` blocks on every
# service's healthcheck (so no manual health-polling needed here). localstripe
# holds its state in memory, so the seed runs on every infra:up.
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm with-env ./scripts/infra.sh up -d --wait

# Seed only when configured for localstripe (real Stripe needs no seeding).
if grep -qE '^\s*STRIPE_API_BASE=' .env 2>/dev/null; then
  pnpm with-env pnpm --filter @acme/billing seed:localstripe
fi
