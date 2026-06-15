#!/usr/bin/env bash
# Bring up infra (via infra.sh, which applies provider-aware profile gating),
# then seed localstripe once it's healthy. localstripe state is in-memory, so
# the seed runs on every infra:up.
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm with-env ./scripts/infra.sh up -d

# Seed only when configured for localstripe (real Stripe needs no seeding).
if grep -qE '^\s*STRIPE_API_BASE=' .env 2>/dev/null; then
  echo "Waiting for localstripe to be healthy…"
  container="${DB_NAME:-app}-localstripe"
  for _ in $(seq 1 40); do
    status="$(./scripts/compose.sh ps -a --format '{{.Names}} {{.Health}}' 2>/dev/null \
      | awk -v c="$container" '$1 == c {print $2}')"
    if [ "$status" = "healthy" ]; then
      break
    fi
    sleep 1
  done

  pnpm with-env pnpm --filter @acme/billing seed:localstripe
fi
