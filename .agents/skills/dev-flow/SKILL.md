---
name: dev-flow
description: Guided feature relay — scope, spec, ticket, build, review. Drop in at any step.
disable-model-invocation: true
---

The **relay**: five steps that carry a feature from idea to merged PR. Each step hands the baton; you decide when to pass it.

## Model table

| Step                        | Model  | Why                                  |
| --------------------------- | ------ | ------------------------------------ |
| wayfinder / grill-with-docs | Opus   | reasoning-heavy — decisions and ADRs |
| to-spec                     | Sonnet | synthesis — no deep reasoning needed |
| to-tickets                  | Sonnet | mechanical breakdown                 |
| implement                   | Sonnet | code generation                      |
| code-review                 | Opus   | judgement-heavy — two-axis review    |

Switch model via `/model` in Claude Code before each step.

## Pipeline

```
wayfinder (fog) ─┐
                 ├─→ grill-with-docs → to-spec → to-tickets → implement → code-review
   quick start ──┘
```

- **wayfinder** entry: multi-session fog — the way to the destination isn't visible yet.
- **quick start** entry: single-session sharpening — you know roughly what you want.
- Say **skip** at any step to pass the baton immediately.
- `implement` always ends with `code-review` — it calls it internally.

## Run the relay

**1. Orient**

Ask: multi-session fog (`/wayfinder`) or single-session sharpening (`/grill-with-docs`)?

Announce the first baton: **"Switch to Opus → type /[wayfinder|grill-with-docs]"**

**2. Each step**

When the user returns from a skill:

- Confirm what was produced (issue URL, ticket list, PR link).
- Announce the next baton: **"Switch to [model] → type /[next-skill], or say skip."**

**3. Relay complete**

After `implement`: confirm the PR is open on `regybean/Trellis`. Hand back to the user for review in the VSCode GitHub Pull Requests extension.

## GitHub

Issues live in `regybean/Trellis` GitHub — not `.scratch/`. When skills publish to the tracker:

- `to-spec` → one GH issue, label `type:spec`, title `[spec] <feature-slug>: <title>`
- `to-tickets` → one GH issue per ticket, label `type:ticket`, native blocking edges via "Blocked by #N" in body
- `wayfinder` → map issue labelled `wayfinder:map`, tickets as child issues

Prefix every issue title with `[<feature-slug>]` for easy filtering via `gh issue list`.

## Worktrees

`implement` runs in an isolated worktree — one Claude Code window per feature, launched with `claude --worktree <feature-slug>`. If already in a worktree session, `/implement` proceeds directly. Parallel features get parallel windows.
