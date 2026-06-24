#!/usr/bin/env bash
# Smart dev launcher.
#
#   pnpm dev                 # every app + exactly the infra they need
#   pnpm dev nextjs          # one app + its infra subset
#   pnpm dev nextjs tanstack-start
#   pnpm dev --no-push nextjs-slim
#
# App args may be short (nextjs-slim) or full (@acme/nextjs-slim); resolve-infra.mjs
# normalises them (turbo's -F needs the full @acme/* name).
#
# Infra is DERIVED from the dependency graph (scripts/resolve-infra.mjs reads each
# package's `acme.infra`), unioned across the target apps, then env-pruned. Only
# that subset is brought up; nothing is assumed on. Infra is left running on exit
# (tear down with `pnpm infra:down`) — re-running is cheap because `up --wait` is
# idempotent and returns immediately when everything is already healthy.
#
# Run via `pnpm with-env` (see root `dev` script) so env-based prunes + db:push
# see ./.env.
set -euo pipefail
cd "$(dirname "$0")/.."

push=1
apps=()
for arg in "$@"; do
  case "$arg" in
    --no-push) push=0 ;;
    -*) echo "dev.sh: unknown flag $arg" >&2; exit 1 ;;
    *) apps+=("$arg") ;;
  esac
done

# Resolve canonical app names + the infra profile set. Both default to "all apps"
# when none are named. Guard the array expansion so an empty list is safe under
# `set -u` (macOS bash 3.2).
if [ ${#apps[@]} -gt 0 ]; then
  app_names="$(node scripts/resolve-infra.mjs --names "${apps[@]}")"
  profiles="$(node scripts/resolve-infra.mjs "${apps[@]}")"
else
  app_names=""
  profiles="$(node scripts/resolve-infra.mjs)"
fi
echo "dev: infra → ${profiles:-(none)}"

if [ -n "$profiles" ]; then
  # --wait blocks until every started service is healthy (cold ollama pulls models
  # on first run — minutes). Idempotent: a no-op when already up + healthy.
  COMPOSE_PROFILES="$profiles" ./scripts/compose.sh up -d --wait

  # localstripe holds products/plans in memory, so (re)seed whenever it's in play.
  case ",$profiles," in
    *,billing,*) pnpm --filter @acme/billing seed:localstripe ;;
  esac

  # Schema push only matters when Postgres is in the set. `--if-present` skips apps
  # with no db:push script (e.g. a future DB-less app). Non-interactive (--force +
  # strict:false in drizzle.push.config.ts) — dev accepts data loss.
  if [ "$push" -eq 1 ] && [[ ",$profiles," == *,postgres,* ]]; then
    if [ -z "$app_names" ]; then
      pnpm --recursive --if-present run db:push
    else
      while IFS= read -r app; do
        [ -n "$app" ] && pnpm --filter "$app" --if-present run db:push
      done <<<"$app_names"
    fi
  fi
fi

# Start dev servers. No app args = all of them.
if [ -z "$app_names" ]; then
  exec turbo watch dev --continue
fi
filters=()
while IFS= read -r app; do
  [ -n "$app" ] && filters+=(-F "$app")
done <<<"$app_names"
exec turbo watch dev --continue "${filters[@]}"
