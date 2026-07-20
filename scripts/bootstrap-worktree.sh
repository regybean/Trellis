#!/usr/bin/env bash
# Bootstrap a freshly-created git worktree so a session starts with everything
# ready — no manual `pnpm install`, no agent tool call.
#
# Two callers: the SessionStart hook in .claude/settings.json (fires on
# `claude --worktree <slug>`), and the /implement skill directly (the
# EnterWorktree tool path fires no hook). A fresh worktree has no node_modules; this
# runs `pnpm install`, which cascades through postinstall: package build,
# skills:register (recreates the .claude/skills symlinks), and link-worktree-env
# (symlinks the primary checkout's .env in). One step bootstraps the lot.
#
# No-op in any checkout that already has node_modules — the primary checkout, or
# a resumed worktree — so it's safe to fire on every session start. Never exits
# non-zero: the session must start regardless; failure is surfaced on stdout.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 0

[ -f pnpm-lock.yaml ] || exit 0      # not a pnpm checkout
[ -d node_modules ] && exit 0        # already bootstrapped

mkdir -p .cache
echo "worktree bootstrap: installing deps + building (log: .cache/bootstrap.log)"
if pnpm install >.cache/bootstrap.log 2>&1; then
  echo "worktree bootstrap: ready"
else
  echo "worktree bootstrap: pnpm install FAILED — see .cache/bootstrap.log"
fi
exit 0
