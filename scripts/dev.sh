#!/usr/bin/env bash
# Smart dev launcher.
#
#   pnpm dev                 # every app + exactly the infra they need
#   pnpm dev nextjs          # one app + its infra subset
#   pnpm dev nextjs tanstack-start
#   pnpm dev --no-push nextjs-slim
#
# App args may be short (nextjs-slim) or full (@acme/nextjs-slim); resolve-infra.ts
# normalises them (turbo's -F needs the full @acme/* name).
#
# Infra is DERIVED from the dependency graph (scripts/resolve-infra.ts reads each
# package's `acme.infra`), unioned across the target apps, then env-pruned. Only
# that subset is brought up; nothing is assumed on. Infra is left running on exit
# (tear down with `pnpm infra:down`) — re-running is cheap because `up --wait` is
# idempotent and returns immediately when everything is already healthy.
#
# Run via `pnpm with-env` (see root `dev` script) so env-based prunes + db:push
# see ./.env.
set -euo pipefail
cd "$(dirname "$0")/.."

# File-lifecycle + follower primitives + resolve_engine (ADR 0028 §5).
# shellcheck source=scripts/lib/dev-logs.sh
. scripts/lib/dev-logs.sh

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
# when none are named — `--names` with no tokens already returns every app, so
# call it in both branches (the no-app branch used to leave app_names="", the
# blind spot that hid every app's dev log from prepare_log — ADR 0028 §4). Guard
# the array expansion so an empty list is safe under `set -u` (macOS bash 3.2).
if [ ${#apps[@]} -gt 0 ]; then
  app_names="$(pnpm exec tsx scripts/resolve-infra.ts --names "${apps[@]}")"
  profiles="$(pnpm exec tsx scripts/resolve-infra.ts "${apps[@]}")"
else
  app_names="$(pnpm exec tsx scripts/resolve-infra.ts --names)"
  profiles="$(pnpm exec tsx scripts/resolve-infra.ts)"
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
  # with no db:push script (e.g. a future DB-less app). `--force` + strict:false in
  # drizzle.push.config.ts suppress the data-loss confirmations — dev accepts data
  # loss — but they do NOT cover everything: when a column is renamed in the schema
  # drizzle-kit still asks "created or renamed from another column?", and that
  # prompt has no flag. Stdin is therefore closed: push aborts with a visible error
  # instead of hanging `pnpm dev` forever on a prompt nobody can see (the symptom
  # was a stale `auth` schema and sign-in failing with `column "email_verified"
  # does not exist`). Resolve a rename by running `pnpm --filter <app> db:push`
  # yourself and answering it.
  if [ "$push" -eq 1 ] && [[ ",$profiles," == *,postgres,* ]]; then
    if [ -z "$app_names" ]; then
      pnpm --recursive --if-present run db:push </dev/null
    else
      while IFS= read -r app; do
        [ -n "$app" ] && pnpm --filter "$app" --if-present run db:push </dev/null
      done <<<"$app_names"
    fi
  fi
fi

# --- Log capture (ADR 0028) --------------------------------------------------
# While the human runs `pnpm dev`, mirror both dev-server output (below turbo,
# per app) and each running compose service's output to clean-text, single-
# generation, dated logs/{dev,infra}-*.log so the agent reads them instead of
# starting `pnpm dev` / `pnpm infra:logs` itself. Capture is coextensive with
# this session: DEV_LOG_DIR gates + is read by the below-turbo dev-app wrappers,
# and the infra followers below are reaped on exit while the containers stay up
# for `pnpm infra:down`. dev.sh keeps `exec` off so it stays alive to own the
# reap trap and run turbo in the foreground.
START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p logs
export DEV_LOG_DIR="$PWD/logs"

# Truncate + dated header for every launching app's dev log, once per session,
# BEFORE turbo starts (ADR 0028 §4). dev-capture (below turbo) only appends, so
# single-generation holds no matter how turbo-watch restarts a dev server. A
# subset run only refreshes its apps; other dev-*.log survive as stale-but-dated.
while IFS= read -r app; do
  [ -n "$app" ] || continue
  slug="${app#@acme/}"
  prepare_log "dev-$slug" "$(dev-log-path "$slug")"
done <<<"$app_names"

# One `<engine> logs -f` follower per running trellis-* container, addressed by
# container name (so profile≠name resolves naturally: trellis-localstripe →
# infra-localstripe.log). `--since "$START"` suppresses the full-history replay a
# reused container would otherwise dump. Enumerate portably via `<engine> ps`
# (podman-compose's `ps` lacks `--status`). Skip silently if no engine is usable.
pids=()
if engine="$(resolve_engine 2>/dev/null)"; then
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    svc="${name#trellis-}"
    pid="$(mirror_stream "infra-$svc" "logs/infra-$svc.log" \
      "$engine" logs -f --since "$START" "$name")"
    pids+=("$pid")
  done < <("$engine" ps --filter status=running --format '{{.Names}}' | grep '^trellis-' || true)
fi

# Reap the followers (only) on exit — infra containers stay up for infra:down.
# Guard the expansion so an empty list is safe under `set -u` (macOS bash 3.2).
trap 'if [ ${#pids[@]} -gt 0 ]; then kill "${pids[@]}" 2>/dev/null || true; fi' EXIT INT TERM

# Start dev servers in the FOREGROUND (no exec) so this shell holds the trap and
# turbo keeps the tty/full-screen TUI; its exit code propagates via `set -e`.
# No app args = all of them.
if [ -z "$app_names" ]; then
  turbo watch dev --continue
else
  filters=()
  while IFS= read -r app; do
    [ -n "$app" ] && filters+=(-F "$app")
  done <<<"$app_names"
  turbo watch dev --continue "${filters[@]}"
fi
