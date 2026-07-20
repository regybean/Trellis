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

## Retire

Once the PR is open, the commits are on the remote — the worktree has done its
job. Retire it immediately so parallel trees don't pile up:

- **Agent (`EnterWorktree` tool):** call `ExitWorktree` with `action: "remove"`
  and `discard_changes: true`. The branch is ahead of `origin/HEAD` locally, so
  the tool would otherwise refuse; but the work is safe on the PR, so dropping
  the local branch loses nothing. A skill directing this retirement is the
  standing authorization `ExitWorktree` asks for — don't wait to be re-prompted.
- **Human (`claude --worktree`):** removed on session exit (you're prompted to
  keep or remove).

Only retire once the push has succeeded and the PR is confirmed open — never on
an unpushed branch.

## Re-enter to iterate

A retired worktree's branch lives only on the remote. To pick the work back up
(to review it or address review comments), recreate a worktree from that branch
rather than starting fresh from `origin/HEAD`:

```bash
git fetch origin
git worktree add ".claude/worktrees/<feature-slug>" "worktree-<feature-slug>"
```

Then switch in with the `EnterWorktree` tool's `path` argument and bootstrap as
above. A worktree entered by `path` is left on disk by `ExitWorktree` (use
`action: "keep"`); remove it with `git worktree remove` once the PR is merged.
