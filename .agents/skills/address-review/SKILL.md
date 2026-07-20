---
name: address-review
description: Address open PR review comments — implement, gate, push, and re-request review.
disable-model-invocation: true
---

**Address** the open review comments on this branch's PR. All PR commands are in [pull-requests.md](docs/agents/pull-requests.md).

## 1. Read the review

Read the PR's unresolved review threads (see pull-requests.md). If no open PR exists for this branch, stop and tell the user. For each thread: identify the file, context, and change needed.

## 2. Implement

Make the changes. Commit per logical grouping — related threads in one commit, not one per thread. Style: concise, lowercase, imperative, no conventional-commits prefix — match the existing PR history.

## 3. Gate

Verify per [quality-gate.md](docs/agents/quality-gate.md). Don't move on until it's green.

## 4. Reply

Push, re-request the original reviewers, and comment a bullet list of each thread addressed and what changed (see pull-requests.md).
