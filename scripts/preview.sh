#!/usr/bin/env bash
# Compiled-build preview launcher (issue #101).
#
#   pnpm preview             # every app + exactly the infra they need
#   pnpm preview nextjs      # one app + its infra subset
#   pnpm preview nextjs tanstack-start
#   pnpm preview --no-push nextjs-slim
#
# Mirrors dev.sh exactly — same short/full app args, same --no-push flag, same
# infra resolution (resolve-infra.mjs → compose up --wait → db:push unless
# --no-push). The ONLY difference is the tail: it runs the COMPILED production
# build via `turbo run start` (dependsOn: build, so turbo rebuilds first) instead
# of `turbo watch dev`. Purpose: measure true time-to-paint — no HMR, no
# dev-server latency — especially IndexedDB cache rehydration (ADR 0025), which
# the dev server inflates. Each app co-launches its queue worker as a turbo `with`
# sidecar (without it chat.send never generates a response), same as dev, minus
# `watch`.
#
# App args may be short (nextjs-slim) or full (@acme/nextjs-slim); resolve-infra.mjs
# normalises them (turbo's -F needs the full @acme/* name).
#
# Infra is left running on exit (tear down with `pnpm infra:down`) — re-running is
# cheap because `up --wait` is idempotent and returns immediately when everything
# is already healthy.
#
# Run via `pnpm with-env` (see root `preview` script) so env-based prunes + db:push
# see ./.env.
set -euo pipefail
cd "$(dirname "$0")/.."

push=1
apps=()
for arg in "$@"; do
  case "$arg" in
    --no-push) push=0 ;;
    -*) echo "preview.sh: unknown flag $arg" >&2; exit 1 ;;
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
echo "preview: infra → ${profiles:-(none)}"

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

# Serve the compiled builds. `turbo run start` rebuilds first (dependsOn: build);
# no app args = all of them.
if [ -z "$app_names" ]; then
  exec turbo run start --continue
fi
filters=()
while IFS= read -r app; do
  [ -n "$app" ] && filters+=(-F "$app")
done <<<"$app_names"
exec turbo run start --continue "${filters[@]}"
