# Worktree workflow

Substantial work is built in an isolated git worktree, so parallel agents don't
step on each other — one window per task.

## Enter

- **Agent:** `/implement` enters a worktree automatically via the `EnterWorktree` tool.
- **Human:** launch a dedicated window with `claude --worktree <feature-slug>`.

Either way the branch is `worktree-<feature-slug>`, based on clean `origin/HEAD`.

## Bootstrap is automatic

Entering a fresh worktree runs `pnpm install` (SessionStart hook → `postinstall`):
deps installed, packages built, skill symlinks recreated, and the primary
checkout's `.env` symlinked in ([ADR 0019](../adr/0019-worktrees-mirror-ci-test-infra.md)).
So all tooling works with nothing to wire by hand.

## Ship

Build → verify ([quality-gate.md](quality-gate.md)) → open a PR ([pull-requests.md](pull-requests.md)).
A clean worktree is removed on session exit; the branch is safe on the remote.
