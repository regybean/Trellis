#!/usr/bin/env bash
# Provision the isolated `*_test` Postgres schemas that backend suites use for
# parallel-cleanup isolation (feedback_test, billing_test, …). `pnpm db:push`
# pushes the four APP schemas; those cover chat/rag (webapp: 'nextjs'), but a
# suite pinned to its own `*_test` schema has no tables until something pushes
# into it. On the fresh-container path the global-setup does this per suite
# (ADR 0021); on the primary checkout nothing did — this closes that gap so the
# local `pnpm test` / `pnpm quality-gate` assumption ("dev db:push already ran")
# is actually true for test schemas too.
#
# Mechanism: reuse the canonical app's own `db:push` (the nextjs schema
# aggregates every feature's push-managed tables) with NEXT_PUBLIC_WEBAPP
# overridden to each test schema. dotenv-cli does not clobber an already-set var,
# so the inline override survives the app's layered `with-env`. One push per
# schema creates every push-managed table there (harmless redundancy, ADR 0021).
#
# Wired into the root `db:push` script, AFTER `turbo db:push`. `pnpm dev` pushes
# via the per-app scripts (scripts/dev.sh), not this, so dev boot is untouched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Discover every isolated test schema from the backend vitest configs — the
# source of truth for `webapp` — so adding a feature never needs editing here.
schemas=$(
  grep -rhoE "webapp: ?['\"][a-zA-Z_]+_test['\"]" --include='vitest.config*.ts' packages |
    grep -oE "[a-zA-Z_]+_test" | sort -u
)

if [ -z "$schemas" ]; then
  echo "no *_test schemas found — nothing to push"
  exit 0
fi

for schema in $schemas; do
  echo "📊 db:push → $schema"
  NEXT_PUBLIC_WEBAPP="$schema" pnpm --filter @acme/nextjs run db:push
done
