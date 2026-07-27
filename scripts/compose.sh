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

# Ollama's pull IDs are single-sourced from @acme/models config (ADR 0026, #120),
# not a duplicated .env row. Resolve + export them so compose interpolates the
# `${OLLAMA_*_MODEL}` refs in compose.yaml's ollama service (always — compose
# interpolates the whole file at parse time, regardless of the active profile).
ollama_models="$(pnpm exec tsx "$(dirname "$0")/resolve-ollama-models.ts")"
while IFS= read -r line; do
  [ -n "$line" ] && export "$line"
done <<<"$ollama_models"

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
