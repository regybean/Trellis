---
name: address-review
description: Address open PR review comments — implement, gate, push, and re-request review.
disable-model-invocation: true
---

**Address** the open review comments on this branch's PR.

## 0. Guard

```bash
gh pr view --json number,state
```

If no open PR exists for this branch, stop and tell the user. Capture the PR number.

## 1. Read the review

```bash
gh pr view --json reviewThreads
```

For each unresolved thread: identify the file, context, and what change is needed.

## 2. Implement

Make the changes. Commit per logical grouping — related threads in one commit, not one per thread. Style: concise, lowercase, imperative, no conventional-commits prefix — match the existing PR history.

After each package you touch: `pnpm turbo run lint typecheck -F @acme/<pkg>`.

## 3. Gate

```bash
pnpm quality-gate
```

On failure, read `.cache/quality-gate.log`, fix, re-run. Don't move on until green.

## 4. Push and re-request

```bash
git push
REVIEWERS=$(gh pr view --json reviews --jq '[.reviews[].author.login] | unique | join(",")')
gh pr edit --add-reviewer "$REVIEWERS"
gh pr comment --body "$(cat <<'EOF'
> *Addressed by AI via /address-review.*

<bullet list of each thread addressed and what changed>
EOF
)"
```
