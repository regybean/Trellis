# Issue tracker: GitHub Issues

Issues and PRDs for this repo live as GitHub issues on `regybean/Trellis`.

## Conventions

- Group by feature with title prefix: `[<feature-slug>] <title>`
- PRD/spec issues carry label `type:spec`
- Implementation tickets carry label `type:ticket`
- Triage state is a GitHub label (see `triage-labels.md` for the role strings)
- Blocking is a `Blocked by #N` line in the issue body (native sub-issues where available)
- Comments and conversation history append as GitHub issue comments

## When a skill says "publish to the issue tracker"

Create a GitHub issue via `gh issue create`:

```bash
gh issue create \
  --title "[<feature-slug>] <title>" \
  --body "..." \
  --label "type:spec,ready-for-agent"
```

## When a skill says "fetch the relevant ticket"

```bash
gh issue view <number>
# or list by feature
gh issue list --search "[<feature-slug>]"
```

The user will normally pass the issue number or URL directly.

## Wayfinding operations

- **Create map**: `gh issue create --label "wayfinder:map" --title "[<slug>] map: <destination>"`
- **Create child ticket**: reference parent with `Parent: #N` in body; label `wayfinder:<type>`
- **Frontier query**: `gh issue list --label "wayfinder:map" --state open`
- **Claim (assign)**: `gh issue edit <N> --add-assignee @me`
- **Resolve**: `gh issue close <N> --comment "Resolution: <answer>"`; append pointer to map's Decisions-so-far
