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

## Read review threads

```bash
gh pr view --json number,state       # confirm an open PR exists; capture the number
gh pr view --json reviewThreads      # each unresolved thread: file, context, change wanted
```

## Reply and re-request review

After pushing fixes:

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
