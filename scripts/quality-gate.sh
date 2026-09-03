#!/usr/bin/env bash
# Full quality gate (ADR 0020). READ-ONLY verification — it never mutates the
# working tree. Auto-fixing is a separate step: run `pnpm tidy` (lint:fix +
# format:fix) before the gate, or let commit-time tidy (lefthook) handle format.
#
# Speed comes from two things (ADR 0020):
#   1. The build-dependent, cacheable turbo tasks (lint, format, typecheck) run in
#      ONE `turbo run … --continue` invocation, so turbo parallelizes them across
#      packages AND task types, honours `^build`, and reuses its cache. `test` is
#      the exception: it needs `scripts/test.sh`'s concurrency cap (ADR 0034),
#      because every backend suite starts its own containers — and that cap must
#      not throttle lint/format/typecheck. So it runs as its own stage, overlapping
#      the batch. `build` — the `^build` prerequisite both of them share — is
#      primed first, in the foreground: two concurrent `turbo run` invocations
#      don't share task execution, so without the prime they each build the graph.
#   2. The standalone read-only checks run as a parallel background group, started
#      before the prime since none of them depend on `build`.
# Because nothing mutates source, everything can overlap safely.
#
# Never fail-fast: every stage runs, each into its own log, concatenated in a
# fixed order into logs/quality-gate.log with a per-stage PASS/FAIL summary —
# so on failure an agent reads one file and sees exactly which stages failed.
# The summary also reports each stage's own duration, the slowest stage, total
# wall time and the turbo cache breakdown (how many tasks were cached vs
# actually ran). Stage durations overlap — only `build` runs serial-before the
# rest — so the column is for finding the long pole, not for summing.
#
# Run this ONCE at the end of a task (e.g. before opening a PR) — not per-commit.
# Commits only tidy (see lefthook.yml); CI is the hard backstop.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SECONDS=0 # wall-clock stopwatch (bash builtin), reported in the summary.

# Per-stage stopwatch. macOS ships bash 3.2 (no $EPOCHREALTIME), so millisecond
# resolution comes from perl where it exists and whole seconds otherwise — the
# stages that lose precision are the sub-second ones that don't matter.
now_ms() {
  if command -v perl >/dev/null 2>&1; then
    perl -MTime::HiRes=time -e 'printf "%d", time() * 1000'
  else
    echo $(($(date +%s) * 1000))
  fi
}

fmt_dur() {
  local ms="${1:-0}"
  if [ "$ms" -ge 60000 ]; then
    printf '%dm%02ds' "$((ms / 60000))" "$((ms % 60000 / 1000))"
  else
    printf '%d.%02ds' "$((ms / 1000))" "$((ms % 1000 / 10))"
  fi
}

# The assembled log lands in the root logs/ dir — the agent-readable location
# (ADR 0028 §1). .cache is claudeignored, so a gate log there is unreadable by
# the agent that has to act on it. Per-stage scratch stays in .cache: it is
# intermediate, and logs/ is a flat *.log dir by contract.
LOG="logs/quality-gate.log"
STAGE_DIR=".cache/quality-gate.d"
mkdir -p "$STAGE_DIR" logs
rm -f "$STAGE_DIR"/*.log "$STAGE_DIR"/*.rc "$STAGE_DIR"/*.ms 2>/dev/null || true

# Fixed order stages appear in the summary and the concatenated log.
order=(build turbo test check:exports check:bank-paths boundaries lint:ws deps:lint test:policy gitleaks audit)

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
  run_stage "$@" &
}

# Same, in the foreground — for a stage the later ones depend on.
run_stage() {
  local name="$1" start rc
  shift
  start=$(now_ms)
  "$@" >"$STAGE_DIR/$name.log" 2>&1
  rc=$?
  echo $(($(now_ms) - start)) >"$STAGE_DIR/$name.ms"
  echo "$rc" >"$STAGE_DIR/$name.rc"
}

# The standalone checks first — none of them depend on `build`, so they overlap
# the prime below. check:exports and check:bank-paths are verify-only, so they
# move out of the `lint` script (which prefixes both) and run as their own
# parallel stages.
launch check:exports    pnpm check:exports
launch check:bank-paths pnpm check:bank-paths
launch boundaries       pnpm boundaries
launch lint:ws          pnpm lint:ws
launch deps:lint        pnpm deps:lint
launch test:policy      pnpm test:policy
launch gitleaks         pnpm gitleaks
launch audit            run_audit

# Prime the `^build` prerequisite once, in the foreground, so the two turbo-backed
# stages below both hit the cache instead of racing to build the graph twice.
run_stage build pnpm turbo run build

# The cacheable, build-dependent turbo tasks in ONE invocation so turbo builds a
# single DAG and parallelises across packages and task types. --continue keeps it
# running past a failed task. `test` goes through its own wrapper for the cap.
launch turbo pnpm turbo run lint format typecheck --continue
launch test  pnpm test

wait

# Read a stage's status from its .rc file (missing/non-zero → FAIL). Kept as a
# function so the log pass and the summary pass agree without an associative
# array (macOS ships bash 3.2, which has none).
stage_status() {
  local rc
  rc=$(cat "$STAGE_DIR/$1.rc" 2>/dev/null || echo 1)
  [ "$rc" = "0" ] && echo PASS || echo FAIL
}

# Same for the stage's own duration, in milliseconds (missing → 0).
stage_ms() {
  cat "$STAGE_DIR/$1.ms" 2>/dev/null || echo 0
}

# Assemble the single legible log in fixed order, behind the same dated
# freshness header every logs/*.log file carries (ADR 0028 §1), so staleness
# reads the same way here as for the dev-/infra- files.
printf "# quality-gate started %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$LOG"
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
  printf '  %-4s %-16s %8s\n' \
    "$(stage_status "$name")" "$name" "$(fmt_dur "$(stage_ms "$name")")"
done

# Turbo cache breakdown — the bulk of the work runs through turbo, which reports
# "N cached, M total". Summed across the three turbo-backed stages (the build
# prime, the lint/format/typecheck batch and `test`); the standalone stages aren't
# turbo-cached, they always run. Skipped silently if no log has the line.
# Every capture is defaulted: an unparsed line must not turn `$(( ))` into a
# syntax error and abort the summary after every stage has already run.
cached=0
total=0
for name in build turbo test; do
  cache_line=$(grep -E 'cached,.*total' "$STAGE_DIR/$name.log" 2>/dev/null | tail -1)
  [ -n "$cache_line" ] || continue
  n_cached=$(printf '%s' "$cache_line" | grep -oE '[0-9]+ cached' | grep -oE '^[0-9]+')
  n_total=$(printf '%s' "$cache_line" | grep -oE '[0-9]+ total' | grep -oE '^[0-9]+')
  cached=$((cached + ${n_cached:-0}))
  total=$((total + ${n_total:-0}))
done
if [ "$total" -gt 0 ]; then
  printf '  cache:   %s/%s turbo tasks cached (%s ran)\n' \
    "$cached" "$total" "$((total - cached))"
fi
slowest=$(for name in "${order[@]}"; do
  printf '%s %s\n' "$(stage_ms "$name")" "$name"
done | sort -rn | head -1)
printf '  slowest: %s (%s) — most stages run in parallel, so the column above\n' \
  "${slowest#* }" "$(fmt_dur "${slowest%% *}")"
echo "           does not sum to elapsed; only 'build' is serial-before the rest"
printf '  elapsed: %dm%02ds\n' "$((SECONDS / 60))" "$((SECONDS % 60))"
echo "  full log: $LOG"
if [ "$failed" -ne 0 ]; then
  echo "  ✗ quality-gate FAILED — grep the failing stage in $LOG"
  echo "  (read-only gate: if it's a fixable lint/format issue, run 'pnpm tidy' then re-run)"
  exit 1
fi
echo "  ✓ quality-gate passed"
