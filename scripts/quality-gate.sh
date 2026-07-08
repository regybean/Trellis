#!/usr/bin/env bash
# Full quality gate (ADR 0020). Runs every stage in ONE pass (never fail-fast),
# tees all output to .cache/quality-gate.log, and prints a per-stage PASS/FAIL
# summary. The point: on failure an agent reads one file and sees exactly which
# stages failed, instead of re-running narrower commands to find the log.
#
# Run this ONCE at the end of a task (e.g. before opening a PR) — not per-commit.
# Commits only tidy (see lefthook.yml); CI is the hard backstop.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG=".cache/quality-gate.log"
mkdir -p .cache
: >"$LOG"

names=()
statuses=()
failed=0

run_stage() {
  local name="$1"
  shift
  {
    echo ""
    echo "━━━━━━━━ $name ━━━━━━━━"
  } | tee -a "$LOG"
  if "$@" >>"$LOG" 2>&1; then
    names+=("$name")
    statuses+=("PASS")
  else
    names+=("$name")
    statuses+=("FAIL")
    failed=1
  fi
}

# Auto-fixers first (mutating, effectively never fail), then verification.
run_stage "lint:fix"        pnpm lint:fix
run_stage "format:fix"      pnpm format:fix
run_stage "typecheck+build" pnpm turbo run typecheck build --continue
run_stage "boundaries"      pnpm boundaries
run_stage "test:policy"     pnpm test:policy
run_stage "lint:ws"         pnpm lint:ws
run_stage "deps:lint"       pnpm deps:lint
run_stage "gitleaks"        pnpm gitleaks
run_stage "test"            pnpm test

echo ""
echo "──────── quality-gate summary ────────"
for i in "${!names[@]}"; do
  printf '  %-4s %s\n' "${statuses[$i]}" "${names[$i]}"
done
echo "  full log: $LOG"
if [ "$failed" -ne 0 ]; then
  echo "  ✗ quality-gate FAILED — grep the failing stage in $LOG"
  exit 1
fi
echo "  ✓ quality-gate passed"
