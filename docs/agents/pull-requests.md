# Pull requests

How PRs are opened and iterated on in this repo (GitHub, `regybean/Trellis`, `gh`
CLI). Skills reference this doc rather than embedding the commands.

## Open a PR

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --base main --title "<feature-slug>" --body "$(cat <<'EOF'
<one-line summary of the change>

Closes #<issue-number>

Commits:
- <commit 1 summary>
- <commit 2 summary>

CONTEXT/ADR changes: <none | files touched>
EOF
)"
```

- Base is always `main`.
- Never open a **draft**; never **auto-merge** — merge is the human's call in the
  VSCode GitHub Pull Requests extension.

## Read review feedback

Feedback lands in two places — read both:

```bash
gh pr view --json number,state       # confirm an open PR exists; capture the number

# 1. Inline review threads (human line comments). `reviewThreads` is NOT a
#    `gh pr view` field — it is GraphQL-only:
gh api graphql -F number="<PR>" \
  -f owner="$(gh repo view --json owner --jq .owner.login)" \
  -f name="$(gh repo view --json name --jq .name)" -f query='
  query($owner:String!,$name:String!,$number:Int!){
    repository(owner:$owner,name:$name){ pullRequest(number:$number){
      reviewThreads(first:50){ nodes{ isResolved path line
        comments(first:20){ nodes{ author{login} body } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)'

# 2. The automated `/code-review` report — posted as an ISSUE comment (not a
#    thread), header `**Code review (automated — /code-review)**`:
gh pr view --json comments \
  --jq '.comments[] | select(.body | startswith("**Code review")) | .body'
```

An empty thread list does **not** mean "no review": the `/code-review` output is
a comment, not a thread. Treat that comment's findings as the review to address.
Only stop and tell the user when an open PR exists but _neither_ source has
feedback (or no open PR exists at all).

## Reply and re-request review

After pushing fixes:

```bash
git push
REVIEWERS=$(gh pr view --json reviews --jq '[.reviews[].author.login] | unique | join(",")')
[ -n "$REVIEWERS" ] && gh pr edit --add-reviewer "$REVIEWERS"  # skip when empty — an automated /code-review comment has no formal reviewer
gh pr comment --body "$(cat <<'EOF'
> *Addressed by AI via /address-review.*

<bullet list of each item addressed and what changed>
EOF
)"
```
