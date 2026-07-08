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
exec turbo run "$task" "$@"
