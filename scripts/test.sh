#!/usr/bin/env bash
# Test entry wrapper. Reifies the "which infra" decision into `CI` *before*
# `turbo run` computes its cache hash, so the two behavioural worlds
# (primary checkout → compose; worktree/CI → testcontainers + skipValidation)
# get distinct cache keys and can never replay across the boundary. See ADR 0019.
#
# A linked git worktree's `.git` is a file (gitlink); the primary checkout's is a
# directory. In a worktree we force CI=true so tests self-provision isolated
# testcontainers (no `pnpm infra:up`) and mirror CI on every axis. Real CI already
# exports CI=true. pnpm runs root scripts from the repo root, so `.git` is relative.
set -euo pipefail

if [ -f .git ]; then
  export CI=true
fi

export NEXT_PUBLIC_WEBAPP="${NEXT_PUBLIC_WEBAPP:-nextjs}"

task="${1:-test}"
[ "$#" -gt 0 ] && shift

# In CI/worktree, backend suites self-provision a Postgres (+Redis) testcontainer
# each in their global-setup. Turbo's default fan-out (concurrency 10) would spin
# up every feature's containers at once — enough Postgres instances to exhaust the
# podman machine's memory/socket. Cap parallelism so containers come up in waves.
# Local (compose-backed) runs share one Postgres and stay unbounded. Override the
# cap with TEST_CONCURRENCY.
if [ "${CI:-}" = "true" ]; then
  exec turbo run "$task" --concurrency="${TEST_CONCURRENCY:-2}" "$@"
fi
exec turbo run "$task" "$@"
