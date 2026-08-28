#!/usr/bin/env bash
# Run `<engine> compose <args>` using whichever container engine is available.
# Override with CONTAINER_ENGINE=docker|podman.
set -euo pipefail

# The dev-deployment concern lives in its own self-contained `deploy/` folder
# (#127): the compose file + its mounted assets + the infra-secret
# `deploy/.env` all sit under it. Run with `-f deploy/compose.yaml
# --project-directory deploy` so the in-file relative paths (`./ops/*`,
# `./localstack-init.sh`, `env_file: ./.env`) all resolve local to `deploy/`.
script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
deploy_dir="$repo_root/deploy"

# shellcheck source=scripts/lib/dev-logs.sh
. "$script_dir/lib/dev-logs.sh"

engine="$(resolve_engine)"

# Compose's provisioning inputs (DB_*/REDIS_PORT/OLLAMA_PORT + ollama pull IDs)
# are single-sourced from the slices' development profiles (ADR 0033 §6, #126), not duplicated .env
# rows. Resolve + export them so compose substitutes the `${...}` refs across the
# whole compose.yaml at parse time (regardless of the active profile).
compose_env="$(pnpm exec tsx "$script_dir/resolve-compose-env.ts")"
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

exec "$engine" compose \
  -f "$deploy_dir/compose.yaml" \
  --project-directory "$deploy_dir" \
  "${profile_args[@]}" "$@"
