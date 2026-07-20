# Worktree workflow

Substantial work is built in an isolated git worktree, so parallel agents don't
step on each other — one window per task.

## Enter

- **Agent:** `/implement` enters a worktree automatically via the `EnterWorktree` tool.
- **Human:** launch a dedicated window with `claude --worktree <feature-slug>`.

Either way the branch is `worktree-<feature-slug>`, based on clean `origin/HEAD`.

## Bootstrap

Either way a fresh worktree gets `pnpm install` → `postinstall`: deps installed,
packages built, skill symlinks recreated, and the primary checkout's `.env`
symlinked in ([ADR 0019](../adr/0019-worktrees-mirror-ci-test-infra.md)). So all
tooling works with nothing to wire by hand — but the two paths trigger it
differently:

- **Human (`claude --worktree`):** the `SessionStart`/`startup` hook fires
  `scripts/bootstrap-worktree.sh` automatically.
- **Agent (`EnterWorktree` tool):** don't rely on a hook here. Claude Code's
  documented `WorktreeCreate` trigger is `--worktree` / subagent
  `isolation: "worktree"` only; the `EnterWorktree` tool path isn't listed (and
  `SessionStart` is process-scoped, so it doesn't fire either). So `/implement`
  runs `scripts/bootstrap-worktree.sh` itself as an explicit step after entering.

The script is idempotent — a no-op once `node_modules` exists.

## Ship

Build → verify ([quality-gate.md](quality-gate.md)) → open a PR ([pull-requests.md](pull-requests.md)).
A clean worktree is removed on session exit; the branch is safe on the remote.
