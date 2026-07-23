---
name: implement
description: Build a piece of work from a spec or tickets — implement in isolation, gate, publish, and review.
disable-model-invocation: true
---

Build the work described in the spec or tickets.

## 0. Resolve the target

Fetch the input from the issue tracker ([issue-tracker.md](docs/agents/issue-tracker.md)) and read its label:

- **`type:ticket`** (or a bare plan/conversation with no tracker) → that _is_ the work.
- **`type:spec`** → don't build the spec itself; build its **frontier ticket** — the first open, unclaimed, unblocked `/to-tickets` child in implementation order. Derive and **claim** it per the tracker doc's "Spec frontier" operation, then treat that ticket as the work. One frontier ticket per session; re-invoke `/implement` on the spec for the next.

The resolved ticket is the source of the `<feature-slug>` and everything below.

## 1. Isolate

Call the **EnterWorktree** tool (name it `<feature-slug>`) before touching any code. Everything below runs inside it.

Then bootstrap the fresh worktree per [worktree-workflow.md](docs/agents/worktree-workflow.md) — the `EnterWorktree` tool path fires no hook, so bootstrap is an explicit step here.

## 2. Implement

Build the plan. Use `/tdd` at the pre-agreed seams.

Commit per logical plan step — one meaningful unit each, so the history narrates the plan. Messages: concise, lowercase, imperative, no conventional-commits prefix (`add env flag`, not `feat: add env flag`). Cite the ticket when one exists.

As you go, run the per-package incremental check for what you touched (see [quality-gate.md](docs/agents/quality-gate.md)). The full suite runs in the gate.

## 3. Gate

Verify once, at the end, per [quality-gate.md](docs/agents/quality-gate.md). Don't move on until it's green.

## 4. Publish

Open a PR per [pull-requests.md](docs/agents/pull-requests.md), citing the source ticket from [issue-tracker.md](docs/agents/issue-tracker.md) (fall back to `.scratch/<feature-slug>/` only when no tracker is configured). Never auto-merge — merge is the human's call.

## 5. Retire

The worktree has served its purpose once the PR is up. Retire it per [worktree-workflow.md](docs/agents/worktree-workflow.md#retire) — only after the PR is confirmed open — leaving the session back in the primary checkout.
