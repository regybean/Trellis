#!/usr/bin/env bash
# Bring up / control local infra WITHOUT any app (postgres/redis/localstack/
# jaeger + env-gated billing/ollama). Profiles default to the full set every app
# needs — the union of `acme.infra` across all apps, env-pruned (same resolver
# dev uses, scripts/resolve-infra.mjs, with no app args). Override by exporting
# COMPOSE_PROFILES. Run via `pnpm with-env` so env-based prunes see ./.env.
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-$(node scripts/resolve-infra.mjs)}"

exec ./scripts/compose.sh "$@"
