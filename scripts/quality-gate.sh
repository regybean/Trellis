#!/usr/bin/env bash
# Full quality gate (ADR 0020). READ-ONLY verification — it never mutates the
# working tree. Auto-fixing is a separate step: run `pnpm tidy` (lint:fix +
# format:fix) before the gate, or let commit-time tidy (lefthook) handle format.
#
# Speed comes from two things (ADR 0020):
#   1. The build-dependent, cacheable turbo tasks (lint, format, typecheck, test)
#      run in ONE `turbo run … --continue` invocation, so turbo parallelizes them
#      across packages AND task types, honours `^build`, and reuses its cache.
#   2. The standalone read-only checks run as a parallel background group.
# Because nothing mutates source, everything can overlap safely.
#
# Never fail-fast: every stage runs, each into its own log, concatenated in a
# fixed order into .cache/quality-gate.log with a per-stage PASS/FAIL summary —
# so on failure an agent reads one file and sees exactly which stages failed.
# The summary also reports total wall time and the turbo cache breakdown
# (how many tasks were cached vs actually ran).
#
# Run this ONCE at the end of a task (e.g. before opening a PR) — not per-commit.
# Commits only tidy (see lefthook.yml); CI is the hard backstop.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SECONDS=0 # wall-clock stopwatch (bash builtin), reported in the summary.

LOG=".cache/quality-gate.log"
STAGE_DIR=".cache/quality-gate.d"
mkdir -p "$STAGE_DIR"
rm -f "$STAGE_DIR"/*.log "$STAGE_DIR"/*.rc 2>/dev/null || true

# Fixed order stages appear in the summary and the concatenated log.
order=(turbo check:exports check:config boundaries lint:ws deps:lint test:policy gitleaks audit)

# Dependency audit (ADR 0027). CI is the hard backstop; locally this stage
# graceful-degrades on network failure (skip + warn, like gitleaks) so offline
# PR prep isn't blocked. A registry that returns advisories still FAILs — only a
# transport error (can't reach the registry) is treated as a skip.
run_audit() {
  local out rc
  out=$(pnpm audit --audit-level=high 2>&1)
  rc=$?
  printf '%s\n' "$out"
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qiE \
    'ENOTFOUND| EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket hang up|getaddrinfo|request to .* failed|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_AUDIT|network'; then
    echo "⚠️  pnpm audit could not reach the registry; skipping (CI enforces)."
    return 0
  fi
  return "$rc"
}

# Launch a stage in the background: name + command. Output → per-stage log,
# exit code → per-stage .rc file. No stage can abort another.
launch() {
  local name="$1"
  shift
  (
    "$@" >"$STAGE_DIR/$name.log" 2>&1
    echo $? >"$STAGE_DIR/$name.rc"
  ) &
}

# The cacheable, build-dependent turbo tasks in ONE invocation so turbo builds a
# single DAG and parallelises across packages and task types. --continue keeps
# it running past a failed task. check:exports and check:config are verify-only,
# so they move out of the `lint` script (which prefixes them) and run as their
# own parallel stages.
launch turbo         pnpm turbo run lint format typecheck test --continue
launch check:exports pnpm check:exports
launch check:config  pnpm check:config
launch boundaries    pnpm boundaries
launch lint:ws       pnpm lint:ws
launch deps:lint     pnpm deps:lint
launch test:policy   pnpm test:policy
launch gitleaks      pnpm gitleaks
launch audit         run_audit

wait

# Read a stage's status from its .rc file (missing/non-zero → FAIL). Kept as a
# function so the log pass and the summary pass agree without an associative
# array (macOS ships bash 3.2, which has none).
stage_status() {
  local rc
  rc=$(cat "$STAGE_DIR/$1.rc" 2>/dev/null || echo 1)
  [ "$rc" = "0" ] && echo PASS || echo FAIL
}

# Assemble the single legible log in fixed order.
: >"$LOG"
failed=0
for name in "${order[@]}"; do
  {
    echo ""
    echo "━━━━━━━━ $name ━━━━━━━━"
    cat "$STAGE_DIR/$name.log" 2>/dev/null
  } >>"$LOG"
  [ "$(stage_status "$name")" = "PASS" ] || failed=1
done

echo ""
echo "──────── quality-gate summary ────────"
for name in "${order[@]}"; do
  printf '  %-4s %s\n' "$(stage_status "$name")" "$name"
done

# Turbo cache breakdown — the bulk of the work runs through turbo, which reports
# "N cached, M total". The standalone stages aren't turbo-cached (they always
# run). Parsed from the turbo stage log; skipped silently if absent.
cache_line=$(grep -E 'cached,.*total' "$STAGE_DIR/turbo.log" 2>/dev/null | tail -1)
if [ -n "$cache_line" ]; then
  cached=$(echo "$cache_line" | grep -oE '[0-9]+ cached' | grep -oE '[0-9]+')
  total=$(echo "$cache_line" | grep -oE '[0-9]+ total' | grep -oE '[0-9]+')
  printf '  cache:   %s/%s turbo tasks cached (%s ran)\n' \
    "$cached" "$total" "$((total - cached))"
fi
printf '  elapsed: %dm%02ds\n' "$((SECONDS / 60))" "$((SECONDS % 60))"
echo "  full log: $LOG"
if [ "$failed" -ne 0 ]; then
  echo "  ✗ quality-gate FAILED — grep the failing stage in $LOG"
  echo "  (read-only gate: if it's a fixable lint/format issue, run 'pnpm tidy' then re-run)"
  exit 1
fi
echo "  ✓ quality-gate passed"
