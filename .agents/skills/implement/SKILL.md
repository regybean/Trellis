---
name: implement
description: Build a piece of work from a spec or tickets — implement in isolation, gate, publish, and review.
disable-model-invocation: true
---

Build the work described in the spec or tickets.

## 0. Isolate

Call the **EnterWorktree** tool (name it `<feature-slug>`) before touching any code. Everything below runs inside it.

Then bootstrap the fresh worktree per [worktree-workflow.md](docs/agents/worktree-workflow.md) — the `EnterWorktree` tool path fires no hook, so bootstrap is an explicit step here.

## 1. Implement

Build the plan. Use `/tdd` at the pre-agreed seams.

Commit per logical plan step — one meaningful unit each, so the history narrates the plan. Messages: concise, lowercase, imperative, no conventional-commits prefix (`add env flag`, not `feat: add env flag`). Cite the ticket when one exists.

As you go, run the per-package incremental check for what you touched (see [quality-gate.md](docs/agents/quality-gate.md)). The full suite runs in the gate.

## 2. Gate

Verify once, at the end, per [quality-gate.md](docs/agents/quality-gate.md). Don't move on until it's green.

## 3. Publish

Open a PR per [pull-requests.md](docs/agents/pull-requests.md), citing the source ticket from [issue-tracker.md](docs/agents/issue-tracker.md) (fall back to `.scratch/<feature-slug>/` only when no tracker is configured). Never auto-merge — merge is the human's call.
