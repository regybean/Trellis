#!/usr/bin/env bash
# Full quality gate: every read-only check the repo has, run in parallel, one
# summary and one log out. Auto-fixing is a separate step — run `pnpm tidy`
# first, or let commit-time tidy (lefthook) handle format.
#
# This file decides nothing. The stage table, the scheduling, the assembled log
# and the summary are `@acme/quality-gate` (tooling/quality-gate), where they
# are typechecked, linted and tested like everything else the gate verifies.
set -euo pipefail

cd "$(dirname "$0")/.."
exec pnpm -C tooling/quality-gate quality-gate "$@"
