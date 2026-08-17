# Issue tracker: GitHub Issues

Issues and specs for this repo live as **GitHub issues** on `regybean/Trellis`.
Use the `gh` CLI for all operations — run inside a clone and it infers the repo
from `git remote -v`.

## Repo constants

| Placeholder  | Value      |
| ------------ | ---------- |
| Owner        | `regybean` |
| Repository   | `Trellis`  |
| Default base | `main`     |

## Ticket-type mapping

Lifecycle is native (open/closed); everything else is a **label**.

| Skill concept                   | GitHub object | Title prefix                     | Distinguisher (label)                           |
| ------------------------------- | ------------- | -------------------------------- | ----------------------------------------------- |
| wayfinder **map**               | Issue         | `[<slug>] map: <destination>`    | `wayfinder:map`                                 |
| wayfinder **ticket**            | Issue         | `[<feature-slug>] …`             | `wayfinder:research\|prototype\|grilling\|task` |
| **spec** (`/to-spec`)           | Issue         | `[<feature-slug>] spec: <title>` | `type:spec`                                     |
| spec **ticket** (`/to-tickets`) | Issue         | `[<feature-slug>] …`             | `type:ticket`                                   |
| bug / risk                      | Issue         | `[<feature-slug>] …`             | `type:bug` / `type:risk`                        |

- **Hierarchy** (map → its tickets): native **sub-issues**. Specs are the
  exception — see [Frontier](#frontier).
- **Blocking** (`blocked by`): native **issue dependencies** where available,
  else a `Blocked by: #N` body line.
- **Lifecycle = issue state**, not a label: a done ticket is **closed**;
  `wontfix` is the label **and** the issue is closed.
- **Triage roles** (`needs-triage`, `ready-for-agent`, …) are **labels** — see
  [triage-labels.md](./triage-labels.md).

## Conventions

- **Create**: `gh issue create --title "[<feature-slug>] <title>" --label "type:ticket,ready-for-agent" --body-file <file>`
- **Read**: `gh issue view <number> --comments`
- **List**: `gh issue list --state open --json number,title,body,labels,assignees --jq '[.[] | {number, title, labels: [.labels[].name], assignees: [.assignees[].login]}]'`, with `--label` / `--state` filters.
- **Comment**: `gh issue comment <number> --body-file <file>`
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."` (labels are created on first use via `gh label create`, not implicitly).
- **Assign / claim**: `gh issue edit <number> --add-assignee @me`
- **Close**: `gh issue close <number> --comment "..."` (`wontfix` = label + close).

### Markdown bodies

GitHub renders issue bodies and comments as markdown directly — there is no
format flag to set. But **never** pass multi-line markdown inline via `--body` in
a way the shell can re-escape: write the markdown to a file and use
`--body-file`, or a quoted heredoc:

```bash
gh issue comment <n> --body "$(cat <<'EOF'
## Heading

**bold**, `code`, and #123 issue refs all render.
EOF
)"
```

Note `#123` in a body creates a **cross-reference** on the target issue — that is
load-bearing for the spec frontier below, not just prose.

### Ticket house style

A ticket body carries the story plus its criteria in named sections (the
`/to-tickets` `<issue-template>` is the canonical shape):

```markdown
As a **<actor>**, I want <capability>, so that <benefit>.

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective —
not a layer-by-layer implementation list.

## Acceptance criteria

- [ ] **Given** <context> **When** <action> **Then** <expected outcome>

## Parent

#<spec-or-map>

## Blocked by

- #<n>, or "None — can start immediately".
```

Where native sub-issue / dependency links exist, they are the source of truth —
the `## Parent` / `## Blocked by` sections are the fallback representation, kept
for specs (which have no sub-issues) and for readability.

### Native links

```bash
# hierarchy: <child> becomes a sub-issue of <parent> (needs the child's numeric DB id)
CHILD_ID=$(gh api repos/regybean/Trellis/issues/<child> --jq .id)
gh api --method POST repos/regybean/Trellis/issues/<parent>/sub_issues -F sub_issue_id="$CHILD_ID"

# blocking: <child> is blocked by <blocker> (again the blocker's DB id, NOT #number or node_id)
BLOCKER_ID=$(gh api repos/regybean/Trellis/issues/<blocker> --jq .id)
gh api --method POST repos/regybean/Trellis/issues/<child>/dependencies/blocked_by -F issue_id="$BLOCKER_ID"
```

GitHub then reports `issue_dependencies_summary.blocked_by` on the child —
**open blockers only**, so it is the live gate. Where sub-issues or dependencies
aren't enabled, fall back to a task list in the parent body plus
`Part of #<parent>` / `Blocked by: #<n>` lines in the child.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo starts treating
external PRs as feature requests; `/triage` reads this flag.)_ `/triage`
processes issues only.

When set to `yes`, PRs run through the same labels and states as issues via the
`gh pr` equivalents (`gh pr view --comments`, `gh pr diff`, `gh pr comment`,
`gh pr edit --add-label`, `gh pr close`). List candidates with
`gh pr list --state open --json number,title,body,labels,author,authorAssociation`
and keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or
`NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).

GitHub shares one number space across issues and PRs, so a bare `#42` may be
either — resolve with `gh pr view 42`, falling back to `gh issue view 42`.

PR mechanics for the **dev loop** (open, review, address) live in
[pull-requests.md](./pull-requests.md).

## When a skill says "publish to the issue tracker"

Create an issue of the mapped type: title prefix, `type:*` / `wayfinder:*` label,
triage label, the house-style body via `--body-file`, then wire its sub-issue /
`blocked_by` links.

## When a skill says "fetch the relevant ticket"

```bash
gh issue view <number> --comments
# or list by feature
gh issue list --search "[<feature-slug>]"
```

The user will normally pass the issue number or URL directly.

## Frontier

The open, unclaimed, unblocked children of a parent — the tickets startable now.
GitHub needs **two** derivations, because maps get native links and specs don't.

### Wayfinding maps (native links)

1. **Children**: the map's open sub-issues (`gh issue list --state open` scoped to
   them, or the map body's task list).
2. **Unclaimed**: drop any with an assignee.
3. **Unblocked**: drop any with `issue_dependencies_summary.blocked_by > 0`, or an
   open issue in its `Blocked by` line.
4. **Order**: first survivor in map order. **Claim** it:
   `gh issue edit <n> --add-assignee @me`.

### Specs (body convention)

A `type:spec` issue is a `/to-tickets` parent. Its implementation tickets bind by
**body convention**, not native sub-issues/dependencies (a spec has no GitHub
sub-issues; tickets report `blocked_by: 0`) — so the query above does not apply:

1. **Children**: each ticket's `## Parent` line is a GitHub cross-reference on the
   spec — read them off its timeline rather than a title-prefix search:
   `gh api repos/regybean/Trellis/issues/<spec>/timeline --paginate --jq '.[] | select(.event=="cross-referenced") | .source.issue'`.
   Keep entries that are open, not a PR, and labelled `type:ticket`.
2. **Unclaimed**: drop any with an assignee.
3. **Unblocked**: drop any whose `## Blocked by` list names a still-open issue
   (`None` = unblocked).
4. **Order**: first survivor by the spec's `## Implementation order`; fall back to
   ascending issue number. Claim it with `gh issue edit <n> --add-assignee @me`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue; its tickets are sub-issues.

- **Map**: `gh issue create --label "wayfinder:map" --title "[<slug>] map: <destination>"` — Notes / Decisions-so-far / Fog live in the body.
- **Child ticket**: an issue wired as a sub-issue of the map (recipe above); label `wayfinder:<type>`. Once claimed, assigned to the driving dev.
- **Blocking**: native dependency link — the UI-visible edge. Unblocked when every blocker is closed.
- **Frontier query**: the map derivation above.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body-file <file>` with the answer, `gh issue close <n>`, then append a context pointer to the map's Decisions-so-far.
- **Asset**: research summaries/prototypes attach to the ticket, not the repo tree — `gh issue comment <n> --body-file <file>`, or `gh gist create <file>` for a large artifact and comment its URL; then link it from the map's Decisions-so-far. Delete the local working file once posted. The tracker is the single source of truth — no local map mirror (`scratch_map*.md`), no loose MD in the repo tree.
