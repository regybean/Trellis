---
name: address-review
description: Address open PR review comments — implement, gate, push, and re-request review.
disable-model-invocation: true
---

**Address** the open review comments on this branch's PR. All PR commands are in [pull-requests.md](docs/agents/pull-requests.md).

## 0. Re-enter the worktree

The PR's worktree was retired once the PR opened, so its branch may live only on the remote (or its dir may still be on disk). Get into it per [worktree-workflow.md](docs/agents/worktree-workflow.md#re-enter-to-iterate); skip when the session is already inside it.

## 1. Read the review

Read the PR's unresolved review feedback (see pull-requests.md) — inline threads _and_ the automated `/code-review` comment; an empty thread list is not "no review". If no open PR exists and neither source has feedback, stop and tell the user. For each item: identify the file, context, and change needed.

## 2. Implement

Make the changes. Commit per logical grouping — related threads in one commit, not one per thread. Style: concise, lowercase, imperative, no conventional-commits prefix — match the existing PR history.

## 3. Gate

Verify per [quality-gate.md](docs/agents/quality-gate.md). Don't move on until it's green.

## 4. Reply

Push, re-request the original reviewers (skip when the feedback was an automated comment — no formal reviewer to re-request), and comment a bullet list of each item addressed and what changed (see pull-requests.md).

## 5. Retire

Once the fixes are pushed, the worktree has served its purpose — retire it per [worktree-workflow.md](docs/agents/worktree-workflow.md#retire), leaving the session back in the primary checkout.
