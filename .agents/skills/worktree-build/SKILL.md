---
name: worktree-build
description: Implement an agreed plan in an isolated git worktree, then open a PR for review in the VSCode GitHub Pull Requests extension. Use after a planning skill (e.g. grill-with-docs) when the user wants the work built in isolation, or when they say "build in a worktree", "isolate this", or "open a PR for this".
---

Build an agreed plan in an isolated worktree and hand back a PR. Designed for **parallel isolated work**: run one Claude Code window per task, each driving this skill on its own `<feature-slug>` branch. Full design rationale: [`docs/agents/worktree-workflow.md`](../../../docs/agents/worktree-workflow.md).

Paths below are relative to the repo root.

## When to use

- A planning skill just finished and the user confirmed they want it built in a worktree.
- The user explicitly asks to isolate work / open a PR for a plan.

Do **not** use for small inline edits — the worktree overhead is only worth it for substantial, multi-commit work.

## Flow

### 1. Pre-flight — protect uncommitted work and sweep orphans

```bash
git status --porcelain
git worktree list
```

If `git status` output is non-empty, **stop and ask** the user how to proceed: commit, stash, or proceed-and-leave-behind. The worktree branches `fresh` from `origin/main`, so uncommitted changes on `main` stay in the original working tree and will NOT come along — never silently strand them.

`git worktree list` surfaces **orphaned worktrees from prior interrupted sessions**. `ExitWorktree` is a no-op on any worktree it did not create *in the current session*, so these can only be cleared with raw git. For each stale `.claude/worktrees/<slug>` that isn't the one you're about to create: if it's clean and its branch is pushed / has a merged-or-open PR, offer to `git worktree remove .claude/worktrees/<slug>`; if it has **uncommitted changes** (check `git -C .claude/worktrees/<slug> status -s`), do **not** remove it — surface it and let the user decide. Never sweep silently.

### 2. Determine the feature slug

Use the `.scratch/<feature-slug>/` slug for the work if one exists (it matches the issue-tracker convention — see `docs/agents/issue-tracker.md`). The slug becomes the worktree dir, branch name, and PR — one identifier across all three. If no slug exists yet, derive a concise kebab-case one from the plan and create `.scratch/<feature-slug>/` if you're tracking issues.

### 3. Enter the worktree

Call the **EnterWorktree** tool with `name: <feature-slug>`. It creates `.claude/worktrees/<feature-slug>` and switches the session in. **The branch it creates is `worktree-<feature-slug>`** — EnterWorktree prepends `worktree-`, so the branch name is *not* the bare slug. The worktree dir is the slug; the branch is `worktree-<slug>`. Don't assume they match.

### 4. Install dependencies

```bash
pnpm install
```

A `fresh` worktree has **no `node_modules`**. Install before committing so the lefthook pre-commit hook resolves `lefthook` (it's a pnpm dep, not a global) and its `pnpm lint:fix` / `pnpm format:fix` commands can run. Skip this and commits emit `Can't find lefthook in PATH` and silently bypass lint/format/gitleaks.

### 5. Implement with multiple commits

Build the plan. Commit **per logical plan step** — each commit one meaningful unit, so the PR's commit list reads as the plan's progress narrated.

- Messages: concise, lowercase, imperative, **no** conventional-commits prefix (`add env flag`, not `feat: add env flag`). Match the repo's existing history.
- When numbered issue files exist (`.scratch/<feature-slug>/issues/NN-*.md`), align commits to them and reference `NN` in the message.

### 6. Push and open a PR

Push the branch that's actually checked out (`worktree-<feature-slug>`), not the bare slug — resolve it rather than hardcoding:

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --draft=false --title "<feature-slug>" --body "$(cat <<'EOF'
<one-line summary of the change>

Plan: .scratch/<feature-slug>/PRD.md

Commits:
- <commit 1 summary>
- <commit 2 summary>

CONTEXT/ADR changes: <none | list files touched>
EOF
)"
```

PR base is **always `main`**.

### 7. Detach — leave nothing on disk

Once the PR is open (step 6), **remove the worktree as the final action of this same turn — do not yield to the user first.** This is the single step that, when skipped, leaves an orphaned worktree holding the branch (so a later `git checkout worktree-<slug>` fails with *"already used by worktree"*).

Call **ExitWorktree** with `action: "remove"`. This skill *owns* the worktree's lifecycle, so calling ExitWorktree here is the **deliberate exception** to its general "don't call proactively" guidance — call it now, don't wait to be asked, and don't rely on the session-exit keep/remove prompt (the user often keeps the session alive, so that prompt never fires).

The branch is safe on the remote (the PR references it), so removing the local worktree + branch leaves nothing to clean up.

- If ExitWorktree refuses because of unpushed commits, step 6's push failed — fix the push, **don't** pass `discard_changes`.
- If ExitWorktree reports it's a **no-op** (you're not in the session that created this worktree — e.g. the build spanned sessions), fall back to raw git: return to the repo root and run `git worktree remove .claude/worktrees/<feature-slug>`. The remote branch + PR survive, so this is safe.

### 8. Hand back

Tell the user the PR is open and to review it in the **VSCode GitHub Pull Requests extension** (`GitHub.vscode-pull-request-github`). On merge, GitHub deletes the remote branch → zero cleanup.

## Gotchas

- **Run `pnpm install` (step 4) before the first commit.** A fresh worktree has no `node_modules`; without it the pre-commit hook can't find `lefthook` (a pnpm dep) and skips lint/format/gitleaks.
- **Uncommitted changes never cross into a worktree.** Always run step 1 first. This is the single most common way to lose track of work.
- **The remote branch is the source of truth after step 5** — that's why removing the local worktree in step 6 is safe and why the PR survives.
- **Parallel runs must use distinct slugs.** Two windows on the same `<feature-slug>` collide on the branch and worktree dir. Keep slugs distinct (the `.scratch/` layout enforces this naturally).
- **Don't auto-merge.** The skill ends at the open PR. Merge/close is the user's call in the PR extension.
- **Never open a draft PR.** Always pass `--draft=false` (or omit `--draft` entirely). PRs here are always ready-to-review.
- **ExitWorktree only works in the session that created the worktree.** Across sessions it's a no-op — it can't remove a worktree from a prior run. Orphans from interrupted sessions accumulate and keep their branch checked out (blocking `git checkout worktree-<slug>`). The only cleanup for those is raw `git worktree remove .claude/worktrees/<slug>`; step 1's `git worktree list` sweep is where you catch them.
- **The branch is `worktree-<slug>`, the dir is `<slug>`.** EnterWorktree prepends `worktree-` to the branch only. Push/checkout the prefixed branch; never assume branch == slug.
- **After EnterWorktree, every absolute path in Read/Write/Edit must start with `.claude/worktrees/<slug>/`.** EnterWorktree switches `cwd` (so `Bash` relative paths and `cd` are fine), but Read/Write/Edit take *absolute* paths — reusing a main-repo absolute path silently writes to **main**, not the worktree. The tells: `pnpm install` reports `resolved 0 / added 0` and the lockfile never picks up your new deps (because the worktree's manifest never actually changed), while `git -C <main> status` shows your edits sitting in main. Prefer worktree-relative paths via `Bash`, or always prefix the worktree dir; if main gets dirtied, `git -C <main> restore <file>` + remove any stray untracked files to reset it.
- **A fresh worktree has no `.env` (it's gitignored, so it never copies in) — that's fine for build/test, but you can't *run* the app.** Env validation is skipped during `next build` (`NEXT_PHASE === 'phase-production-build'` is in every `env.ts` `skipValidation` predicate, alongside CI/lint), so `pnpm build` / `pnpm typecheck` no longer abort on missing runtime env (Stripe keys, DB creds, AWS) — they build clean without `.env`. Runtime env is instead validated when the server boots (`apps/nextjs/src/instrumentation.ts` resolves the active model providers; `createEnv` validates the rest on first import). So: builds and `pnpm lint` / `pnpm boundaries` / `pnpm lint:ws` all work in a bare worktree; only actually starting the app needs a real `.env`.
