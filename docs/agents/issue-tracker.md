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

## Spec frontier

A `type:spec` issue is a `/to-tickets` parent. Its implementation tickets bind by **body convention**, not native sub-issues/dependencies (a spec has no GitHub sub-issues; tickets report `blocked_by: 0`) — so the Wayfinding frontier query below does not apply. Derive the spec's frontier:

1. **Children**: each ticket's `## Parent` line is a GitHub cross-reference on the spec — read them off its timeline rather than a title-prefix search: `gh api repos/<owner>/<repo>/issues/<spec>/timeline --paginate --jq '.[] | select(.event=="cross-referenced") | .source.issue'`. Keep entries that are open, not a PR, and labelled `type:ticket`.
2. **Unclaimed**: drop any with an assignee.
3. **Unblocked**: drop any whose `## Blocked by` list names a still-open issue (`None` = unblocked).
4. **Order**: first survivor by the spec's `## Implementation order`; fall back to ascending issue number. Claim it with `gh issue edit <n> --add-assignee @me`.

## Wayfinding operations

- **Create map**: `gh issue create --label "wayfinder:map" --title "[<slug>] map: <destination>"`
- **Create child ticket**: reference parent with `Parent: #N` in body; label `wayfinder:<type>`
- **Frontier query**: `gh issue list --label "wayfinder:map" --state open`
- **Claim (assign)**: `gh issue edit <N> --add-assignee @me`
- **Resolve**: `gh issue close <N> --comment "Resolution: <answer>"`; append pointer to map's Decisions-so-far
- **Asset**: research summaries/prototypes attach to the ticket, not the repo tree — `gh issue comment <N> --body-file <file>` (or a gist for large artifacts), then link from the map's Decisions-so-far; delete the local working file once posted. The tracker is the source of truth — no local map mirror (`scratch_map*.md`), no loose MD in the repo.
