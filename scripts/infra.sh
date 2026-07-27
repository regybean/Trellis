#!/usr/bin/env bash
# Bring up / control local infra WITHOUT any app (postgres/redis/localstack/
# jaeger + env-gated billing/ollama). Profiles default to the full set every app
# needs — the union of `acme.infra` across all apps, env/config-pruned (same
# resolver dev uses, scripts/resolve-infra.ts, with no app args). Override by
# exporting COMPOSE_PROFILES. Run via `pnpm with-env` so the STRIPE_API_BASE
# prune sees ./.env.
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-$(pnpm exec tsx scripts/resolve-infra.ts)}"

exec ./scripts/compose.sh "$@"
