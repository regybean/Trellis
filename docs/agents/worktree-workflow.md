# Worktree workflow: parallel isolated agents → PRs

How substantial agent work gets built in isolation and reviewed via the VSCode GitHub Pull Requests extension. The build itself is driven by the `/implement` skill; this doc is the rationale and the standing rules.

## When isolation applies

Worktrees are for **large, speculative work** — typically kicked off by the `/dev-flow` relay (`grill-with-docs` → `to-spec` → `to-tickets` → `implement`). Ad-hoc edits and one-liners stay on the main working tree; the worktree overhead isn't worth it.

The relay's `implement` step always runs in an isolated worktree. The decision to isolate is made after planning is settled — by then the scope is clear.

## Parallel, isolated

The point is running **multiple agents at once without them stepping on each other**. The model is **one Claude Code window per task**, each launched into its own worktree:

```bash
claude --worktree <feature-slug>
```

Native worktree creation branches `worktree-<feature-slug>` from `origin/HEAD` (a clean `fresh` tree — see `worktree.baseRef`), places it under `.claude/worktrees/<feature-slug>/`, and copies gitignored config in. Each window is interactive, so the "ask after the plan" handoff works in every window. There's no central orchestrator — independence is the feature.

## Bootstrap is invisible

A fresh worktree has no `node_modules`, so the lefthook pre-commit hook can't resolve (`lefthook` is a pnpm dep, not a global) and packages have no `dist` barrels. Rather than make the agent remember to install, the **`SessionStart` hook** (`.claude/settings.json` → `scripts/bootstrap-worktree.sh`) runs `pnpm install` when the session starts in a fresh checkout. That one command cascades through `postinstall`: package build, `skills:register` (recreates the `.claude/skills` symlinks, which are gitignored and don't survive into a worktree), and `link-worktree-env` (symlinks the primary checkout's `.env` in — see [ADR 0019](../adr/0019-worktrees-mirror-ci-test-infra.md)). It's a no-op in any checkout that already has `node_modules`. So by the time `/implement` runs, everything is in place — nothing to install or wire by hand.

## The flow

Per window:

1. **Launch** — `claude --worktree <feature-slug>`; native creation + the SessionStart bootstrap leave a ready checkout.
2. **Implement** — run `/implement`. Multiple commits, one per logical plan step; concise lowercase imperative messages (no `feat:`/`docs:` prefix); reference issue `NN` when `.scratch/<feature-slug>/issues/` files exist. Commits only _tidy_ (format + secret scan, ADR 0020) — do **not** run `pnpm quality-gate` per commit.
3. **Gate** — `/implement` runs `pnpm tidy` (auto-fix) then `pnpm quality-gate` **once**, after the last commit, before publishing. The gate is **read-only** and parallel — it verifies, it doesn't fix, so `tidy` runs first. It writes `.cache/quality-gate.log` with a per-stage PASS/FAIL summary; on failure read that file for the failing stage, fix (or re-`tidy`), re-run. CI is the backstop, but a green gate here means a green PR.
4. **Publish** — `git push -u origin worktree-<feature-slug>` → `gh pr create --base main`; body = summary + link to `.scratch/<feature-slug>/PRD.md` + commit bullets + CONTEXT/ADR notes.
5. **Review** _(human)_ — open the PR in the VSCode GitHub Pull Requests extension, read the diff, leave comments or merge. GitHub deletes the remote branch on merge → zero cleanup.
6. **Address review** — if the reviewer left comments, run `/address-review`; it implements the changes, re-gates, pushes, and re-requests review. Repeat until approved.
7. **Detach** — on session exit, native cleanup removes the worktree if it's clean, or prompts to keep/remove if there are uncommitted changes. The branch is safe on the remote (the PR references it), so nothing is stranded.

## Decisions

- **Trigger:** planning-skill use, prompted _after_ the plan is produced.
- **Entry:** launch-driven — `claude --worktree <slug>`, one window per task — not an in-session tool call. This is the path where dependency install is genuinely invisible (native creation + `SessionStart` hook), with no custom `WorktreeCreate` hook replacing git's own worktree logic.
- **Bootstrap:** `SessionStart` hook runs `pnpm install` on a fresh worktree; `postinstall` does the rest (build + skill symlinks + `.env` symlink). No manual install step.
- **Review surface:** GitHub PR, viewed in VSCode (`GitHub.vscode-pull-request-github`, in `.vscode/extensions.json`). Chosen for the richest diff view and because the worktree commits stay visible as PR history.
- **Cleanup:** native session-exit cleanup — a clean worktree is removed automatically; a dirty one prompts. The remote branch carries the PR, so a removed local worktree strands nothing. Orphans from interrupted runs are swept with `git worktree list` + `git worktree remove`.
- **Base ref:** `fresh` (from `origin/HEAD`) — every agent starts from known-clean `main` so each PR is reviewable against `main` with no drift.
- **Naming:** worktree dir == `<feature-slug>` == `.scratch/<feature-slug>/`. The **branch is `worktree-<feature-slug>`** — native creation prepends `worktree-`. One slug everywhere except the branch, which carries the prefix.
- **PR shape:** base always `main`. Agent never auto-merges; merge/close is the human's call.
- **Commits:** per logical plan step; align to numbered issue files when present.

## Codified in

- `/implement` skill — `.agents/skills/implement/SKILL.md` (build → gate → publish; PR when in a worktree).
- `/address-review` skill — `.agents/skills/address-review/SKILL.md` (implement review comments → gate → push → re-request review).
- `scripts/bootstrap-worktree.sh` + `.claude/settings.json` `SessionStart` hook — the invisible dependency bootstrap.
- `.vscode/extensions.json` — recommends the GitHub Pull Requests extension.
