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
- **Agent (re-entered by `path`, e.g. `/address-review`):** `ExitWorktree` will
  not remove a `path`-entered worktree — call it with `action: "keep"` to return
  to the primary checkout, then `git worktree remove --force
.claude/worktrees/<feature-slug>` to delete it. Same safety as above: the
  fixes are already pushed, so nothing local is lost.

Only retire once the push has succeeded and the PR is confirmed open — never on
an unpushed branch.

## Re-enter to iterate

A retired worktree's branch lives only on the remote — but its worktree dir may
also still be on disk from an earlier pass. Check before recreating, rather than
starting fresh from `origin/HEAD`:

```bash
git fetch origin
git worktree list   # already listed? reuse it — skip the add
# only when absent:
git worktree add ".claude/worktrees/<feature-slug>" "worktree-<feature-slug>"
```

Then switch in with the `EnterWorktree` tool's `path` argument and bootstrap as
above — unless the session is already inside it (`EnterWorktree` errors on the
current working directory), in which case skip both. Retire it when done per
[Retire](#retire) (the `path`-entered case); the fixes are on the remote, so
there's no reason to leave it lying around.
