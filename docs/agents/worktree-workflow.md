# Worktree workflow: parallel isolated agents → PRs

How substantial agent work gets built in isolation and reviewed via the VSCode GitHub Pull Requests extension. The invokable half lives in the `/worktree-build` skill; this doc is the rationale and the standing rules.

## When isolation applies

Worktrees are for **large, speculative work** — typically kicked off by a planning skill (e.g. `grill-with-docs`). Ad-hoc edits and one-liners stay on the main working tree; the worktree overhead isn't worth it.

A planning skill produces a plan, then **asks** whether to implement it in a worktree. The decision is made after the plan exists, not before — by then the scope is clear.

## Parallel, isolated

The point of worktrees here is running **multiple agents at once without them stepping on each other**. The model is **one Claude Code window per task**, each:

1. running a planning skill,
2. answering the "build in a worktree?" prompt,
3. driving `/worktree-build` on its own `<feature-slug>` branch.

Each window is interactive, so the "ask after the plan" handoff works in every window. There's no central orchestrator — independence is the feature.

## The flow

Per window (implemented by `/worktree-build`):

1. **Pre-flight** — `git status`; if `main` has uncommitted changes, pause and ask (commit / stash / proceed-and-leave-behind). Worktrees never carry uncommitted changes across.
2. **Isolate** — `EnterWorktree` with `name: <feature-slug>`, base ref `fresh` (branches from `origin/main`).
3. **Install** — `pnpm install` in the fresh worktree (no `node_modules` otherwise), so the lefthook pre-commit hook resolves (`lefthook` is a pnpm dep, not a global) and its format + secret-scan commands run instead of emitting `Can't find lefthook in PATH` and silently skipping.
4. **Implement** — multiple commits, one per logical plan step; concise lowercase imperative messages (no `feat:`/`docs:` prefix); reference issue `NN` when `.scratch/<feature-slug>/issues/` files exist. Commits only _tidy_ (format + secret scan, ADR 0020) — do **not** run `pnpm quality-gate` per commit.
5. **Gate** — run `pnpm quality-gate` **once**, after the last commit, before publishing. It runs every stage in one pass and writes the full log to `.cache/quality-gate.log`; on failure read that file for the failing stage, fix, re-run. CI is the backstop, but a green gate here means a green PR.
6. **Publish** — `git push -u origin <feature-slug>` → `gh pr create --base main`; body = summary + link to `.scratch/<feature-slug>/PRD.md` + commit bullets + CONTEXT/ADR notes.
7. **Detach** — `ExitWorktree remove`; branch is safe on the remote, nothing left on disk.
8. **Review** — open the PR in the VSCode GitHub Pull Requests extension, read the diff, merge. GitHub deletes the remote branch on merge → zero cleanup.

## Decisions

- **Trigger:** planning-skill use, prompted _after_ the plan is produced.
- **Review surface:** GitHub PR, viewed in VSCode (`GitHub.vscode-pull-request-github`, in `.vscode/extensions.json`). Chosen for the richest diff view and because the worktree commits stay visible as PR history.
- **Cleanup:** agent removes the local worktree as the final action of the turn that opens the PR (`ExitWorktree remove`, the deliberate exception to that tool's "don't call proactively" rule); the remote branch carries the PR. Do not defer to the session-exit keep/remove prompt — a kept-alive session never fires it, and `ExitWorktree` cannot remove a worktree across sessions (it's a no-op on anything it didn't create this session). Orphans from interrupted runs are swept at pre-flight via `git worktree list` + raw `git worktree remove`.
- **Base ref:** `fresh` (from `origin/main`) — every agent starts from known-clean `main` so each PR is reviewable against `main` with no drift. Pre-flight prompt guards uncommitted local work.
- **Naming:** worktree dir == `<feature-slug>` == `.scratch/<feature-slug>/`. The **branch is `worktree-<feature-slug>`** — `EnterWorktree` prepends `worktree-`. One slug everywhere except the branch, which carries the prefix.
- **PR shape:** base always `main`. Agent never auto-merges; merge/close is the user's call.
- **Commits:** per logical plan step; align to numbered issue files when present.

## Codified in

- `/worktree-build` skill — `.claude/skills/worktree-build/SKILL.md` (the invokable flow).
- Planning skills (e.g. `grill-with-docs`) end by offering `/worktree-build` when this project provides it.
- `.vscode/extensions.json` — recommends the GitHub Pull Requests extension.
