#!/usr/bin/env bash
# Bring up the full infra rig and wait until healthy, then seed localstripe.
# infra.sh resolves + env-gates the profiles; `up --wait` blocks on every
# service's healthcheck (so no manual health-polling needed here). localstripe
# holds its state in memory, so the seed runs on every infra:up.
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm with-env ./scripts/infra.sh up -d --wait

# Seed localstripe. The connection is authored config (@acme/env ADR 0001), so the seed
# self-guards on it — a no-op when the connection resolves to real
# Stripe — and is safe to run unconditionally. If the `billing` profile wasn't
# started (real Stripe), the compose stack simply has no localstripe container.
pnpm with-env pnpm --filter @acme/billing seed:localstripe
