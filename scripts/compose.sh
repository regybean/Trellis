#!/usr/bin/env bash
# Run `<engine> compose <args>` using whichever container engine is available.
# Override with CONTAINER_ENGINE=docker|podman.
set -euo pipefail

engine="${CONTAINER_ENGINE:-}"

if [ -z "$engine" ]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    engine=docker
  elif command -v podman >/dev/null 2>&1; then
    engine=podman
  else
    echo "compose.sh: no usable container engine found (need docker or podman)." >&2
    exit 1
  fi
fi

# Compose's provisioning inputs (DB_*/REDIS_PORT/OLLAMA_PORT + ollama pull IDs)
# are single-sourced from the slice configs (ADR 0026, #126), not duplicated .env
# rows. Resolve + export them so compose substitutes the `${...}` refs across the
# whole compose.yaml at parse time (regardless of the active profile).
compose_env="$(pnpm exec tsx "$(dirname "$0")/resolve-compose-env.ts")"
while IFS= read -r line; do
  [ -n "$line" ] && export "$line"
done <<<"$compose_env"

# podman-compose ignores the COMPOSE_PROFILES env var (docker honors it), so
# translate it into explicit --profile flags, which both engines accept.
profile_args=()
if [ -n "${COMPOSE_PROFILES:-}" ]; then
  IFS=',' read -ra _profiles <<<"$COMPOSE_PROFILES"
  for p in "${_profiles[@]}"; do
    [ -n "$p" ] && profile_args+=(--profile "$p")
  done
fi

exec "$engine" compose "${profile_args[@]}" "$@"
