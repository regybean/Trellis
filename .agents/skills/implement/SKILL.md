---
name: implement
description: Build an agreed plan (spec or tickets), gate it, review it, and publish — a PR when run in a worktree, else commits on the current branch.
disable-model-invocation: true
---

Build the work described in the spec or tickets.

Run this **inside the target checkout**. For isolated / parallel work, launch it in its own worktree first — `claude --worktree <feature-slug>`, one window per task. Deps, package build, `.env`, and the `.claude/skills` symlinks are already in place: worktree creation bootstraps them (SessionStart hook → `pnpm install` → postinstall). There is nothing to install or enter by hand. Rationale and standing rules: [docs/agents/worktree-workflow.md](../../../docs/agents/worktree-workflow.md).

## 1. Implement

Build the plan. Use `/tdd` at the pre-agreed seams.

Commit **per logical plan step** — each commit one meaningful unit, so the history reads as the plan's progress narrated. Messages: concise, lowercase, imperative, **no** conventional-commits prefix (`add env flag`, not `feat: add env flag`) — match the repo's history. When numbered issue files exist (`.scratch/<feature-slug>/issues/NN-*.md`), align commits to them and cite `NN`.

As you go, typecheck and run single test files for the package you touched (`pnpm turbo run lint typecheck -F @acme/<pkg>` — cached, seconds). Don't run the full suite or `quality-gate` per commit.

## 2. Gate

After the last commit, run `pnpm quality-gate` **once**. It runs every stage in one pass and writes `.cache/quality-gate.log`; on failure read that file for the failing stage, fix, re-run. Don't move on until the gate is green.

## 3. Review

Run `/code-review` on the work and address what it surfaces. Re-gate if you changed code.

## 4. Publish

**On a `worktree-<feature-slug>` branch** — you're in an isolated worktree, so ship a PR:

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --draft=false --title "<feature-slug>" --body "$(cat <<'EOF'
<one-line summary of the change>

Plan: .scratch/<feature-slug>/PRD.md

Commits:
- <commit 1 summary>
- <commit 2 summary>

CONTEXT/ADR changes: <none | files touched>
EOF
)"
```

Base is always `main`. **Never** open a draft; **never** auto-merge — merge is the human's call in the VSCode GitHub Pull Requests extension. Then hand back: the PR is open, review it there. The worktree cleans itself up on session exit (the branch is safe on the remote), so there is nothing to tear down.

**On the primary checkout** — any other branch: the commits on the current branch are the deliverable. Stop there; don't push or open a PR unless asked.
