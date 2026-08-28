#!/usr/bin/env bash
# Bring up / control local infra WITHOUT any app (postgres/redis/localstack/
# jaeger + env-gated billing/ollama). Profiles default to the full set every app
# needs — the union of `acme.infra` across all apps, config-pruned (same resolver
# dev uses, scripts/resolve-infra.ts, with no app args; the billing/ollama prunes
# read the slices' development profiles, not env). Override by exporting COMPOSE_PROFILES. Run via
# `pnpm with-env` so compose can interpolate the container-password secrets.
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROFILES="${COMPOSE_PROFILES:-$(pnpm exec tsx scripts/resolve-infra.ts)}"

exec ./scripts/compose.sh "$@"
