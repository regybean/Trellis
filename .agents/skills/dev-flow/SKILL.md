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

Use `/model` in Claude Code to switch — only two transitions in the relay: Opus→Sonnet after `grill-with-docs`, Sonnet→Opus after `implement`.

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

**2. Execute inline**

Once the user decides, read `.agents/skills/<name>/SKILL.md` for that step and execute its instructions directly — no announcement, just run it. When that step is done, move to the next: read its SKILL.md and execute. Continue through the pipeline.

At the two model transitions, pause before proceeding — these are the natural compact checkpoints:

- `grill-with-docs` → `to-spec`: suggest switching to Sonnet; offer `/compact focus on design decisions and domain terms`
- `implement` → `code-review`: suggest switching to Opus; offer `/compact focus on the implementation and PR`

Offer compaction only if the session feels heavy (long grilling, many code edits). Don't offer it at every transition.

After each completed step, ask: **"skip or continue?"** before reading the next skill.

**3. Relay complete**

After `implement`: confirm the PR is open on `regybean/Trellis`. Hand back for review in the VSCode GitHub Pull Requests extension.

## GitHub

Issues live in `regybean/Trellis` GitHub — not `.scratch/`. When skills publish to the tracker:

- `to-spec` → one GH issue, label `type:spec`, title `[spec] <feature-slug>: <title>`
- `to-tickets` → one GH issue per ticket, label `type:ticket`, native blocking edges via "Blocked by #N" in body
- `wayfinder` → map issue labelled `wayfinder:map`, tickets as child issues

Prefix every issue title with `[<feature-slug>]` for easy filtering via `gh issue list`.

## Context

There's no automatic token-count detection. Use `/statusline` in Claude Code to display context usage live in the status bar — set it once and it's always visible.

Compact at the two transition checkpoints (above). The focus argument preserves what matters for the next step: `/compact focus on <topic>`. CC auto-compacts when it hits its own threshold, but the transition points are better — you choose what survives.

## Worktrees

`implement` runs in an isolated worktree — one Claude Code window per feature, launched with `claude --worktree <feature-slug>`. If already in a worktree session, `/implement` proceeds directly. Parallel features get parallel windows.
