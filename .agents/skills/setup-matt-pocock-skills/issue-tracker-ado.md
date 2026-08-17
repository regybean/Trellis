# Issue tracker: Azure DevOps

Issues and specs for this repo live as **Azure DevOps (ADO) work items** on the
project's Boards. Use the `az` CLI with the `azure-devops` extension for all
operations (`az extension add --name azure-devops` if it is missing).

Fill in the placeholders once, near the top of the instantiated
`docs/agents/issue-tracker.md`, and reuse them everywhere below:

- `<org-url>` — e.g. `https://dev.azure.com/<org>`
- `<project>` — the ADO project (URL-encode spaces as `%20` in REST URIs)
- `<repo>` — the Git repository name
- `<area-path>` — the Area Path that maps to your team's board (e.g. `<project>\<team>`)
- `<iteration>` — the Iteration Path new work lands in (often the project root)

Set CLI defaults once per machine so later commands stay short:

```bash
az devops configure --defaults organization=<org-url> project="<project>"
```

## Work-item type mapping

ADO has first-class **work item types** and a **State** workflow, so the skills'
"labels" split two ways — type + state are native, everything else is a **tag**.

| Skill concept                   | ADO type   | Distinguisher (tag)                             |
| ------------------------------- | ---------- | ----------------------------------------------- |
| wayfinder **map**               | Feature    | `wayfinder:map`                                 |
| wayfinder **ticket**            | User Story | `wayfinder:research\|prototype\|grilling\|task` |
| **spec** (`/to-spec`)           | Feature    | `type:spec`                                     |
| spec **ticket** (`/to-tickets`) | User Story | `type:ticket`                                   |
| other action item from a spec   | Task       | —                                               |
| bug / risk                      | Bug / Risk | —                                               |

- **Hierarchy** (map/spec Feature → its tickets): native `parent`/`child` links.
- **Blocking** (`blocked by`): native `predecessor`/`successor` links — the
  blocker is the **predecessor** of the ticket it blocks.
- **Lifecycle** is the native **State** field, not a tag: a ticket is "closed"
  ⇒ `State = Closed`; `wontfix` ⇒ `State = Removed`. Triage _roles_
  (`needs-triage`, `ready-for-agent`, …) are **tags** (see `triage-labels.md`).

> This mapping assumes the **Agile** process (it has `User Story`). On **Scrum**
> substitute `Product Backlog Item` for `User Story`; on **CMMI**, `Requirement`.
> Confirm with `az boards work-item create --help` or by listing the project's
> work-item types.

## Conventions

- **Create a work item**: `az boards work-item create --title "..." --type "<type>" --area '<area-path>' --iteration '<iteration>' --fields "System.Tags=<tag>; <tag>"`.
  - **Tags** go in a single `System.Tags` value, `; `-separated. They are created
    on first use (no pre-registration) unless the org restricts the
    "Create tag definition" permission.
  - Always stamp `--area '<area-path>' --iteration '<iteration>'` or the item
    lands at the project root and misses the team board. Single-quote the
    backslashes in the paths.
- **Rich fields as markdown** (`System.Description`,
  `Microsoft.VSTS.Common.AcceptanceCriteria`): `az boards work-item create`
  stores multiline fields as **HTML**, so raw markdown renders literally. To get
  rendered markdown, set the field **and** its format flag with a JSON-Patch via
  `az rest` (see the recipe below).
- **Read a work item**: `az boards work-item show --id <id> --output json` (add
  `--expand all` for relations/links).
- **List / query**: `az boards query --wiql "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE ..."`.
- **Comment**: `az boards work-item update --id <id> --discussion "..."`.
- **Apply / remove a tag**: read `System.Tags`, edit the `; `-joined string, and
  write it back with `--fields "System.Tags=..."` (ADO has no add/remove-tag verb).
- **Assign / claim**: `az boards work-item update --id <id> --assigned-to "<email>"`.
- **Close**: `az boards work-item update --id <id> --state "Closed"`
  (`Removed` for wontfix).

### Markdown field recipe (verified)

`az boards` cannot set the markdown format flag, so use `az rest` with a
JSON-Patch that writes both the value and `/multilineFieldsFormat/<field>`:

```bash
cat > /tmp/wi.json <<'JSON'
[
  {"op":"add","path":"/fields/System.Description","value":"## Heading\n\n**bold**\n\n- a\n- b"},
  {"op":"add","path":"/multilineFieldsFormat/System.Description","value":"Markdown"}
]
JSON
az rest --method patch \
  --uri "<org-url>/<project-encoded>/_apis/wit/workitems/<id>?api-version=7.1" \
  --resource "499b84ac-1321-427f-aa17-267ca6975798" \
  --headers "Content-Type=application/json-patch+json" \
  --body @/tmp/wi.json
```

The resource GUID `499b84ac-1321-427f-aa17-267ca6975798` is the fixed Azure
DevOps AAD application ID — the token audience for `az rest` against ADO. Use
real newlines in the JSON string (a literal `\n` in `--fields` is stored
verbatim). The same recipe sets `Microsoft.VSTS.Common.AcceptanceCriteria`.

### Native links (verified)

```bash
# hierarchy: make <child> a child of <parent> (Feature ← User Story/Task)
az boards work-item relation add --id <child> --relation-type parent --target-id <parent>
# blocking: <ticket> is blocked by <blocker>  (blocker = predecessor)
az boards work-item relation add --id <ticket> --relation-type predecessor --target-id <blocker>
```

On the child/blocked item these show as `System.LinkTypes.Hierarchy-Reverse` and
`System.LinkTypes.Dependency-Reverse` respectively.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` for an open-contribution repo
where external PRs are feature requests; `/triage` reads this flag.)_ When `yes`,
run PRs through the same tags/states using `az repos pr show` / `az repos pr list`
and the PR-thread API for comments — see `pull-requests.md` for the verbs.

## When a skill says "publish to the issue tracker"

Create a work item of the mapped type (above), stamped with area, iteration, and
tags, then apply the markdown recipe for its Description / Acceptance Criteria and
wire its `parent` / `predecessor` links.

## When a skill says "fetch the relevant ticket"

`az boards work-item show --id <id> --expand all --output json`. The user will
normally pass the work-item id or URL directly.

## Frontier (wayfinding **and** specs, unified)

ADO gives both maps and specs real `parent`/`predecessor` links, so a **single**
native-link frontier serves both `/wayfinder` and a `/to-tickets` spec parent —
there is no body-convention special case.

1. **Open, unassigned children** of the map/spec `<parent>`:

   ```bash
   az boards query --wiql "SELECT [System.Id] FROM WorkItems \
     WHERE [System.Parent] = <parent> \
       AND [System.State] NOT IN ('Closed','Removed') \
       AND [System.AssignedTo] = '' \
     ORDER BY [System.Id]"
   ```

2. **Drop the blocked**: for each candidate, read its predecessors
   (`System.LinkTypes.Dependency-Reverse` targets from `--expand all`); if any is
   still open (`State NOT IN ('Closed','Removed')`), the candidate is blocked.
3. **Order**: first survivor by the parent's stated implementation order, else
   ascending id. **Claim** it: `az boards work-item update --id <n> --assigned-to "<email>"`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a `Feature`; its tickets are child work items.

- **Map**: `az boards work-item create --type Feature --title "map: <destination>" --area '<area-path>' --iteration '<iteration>' --fields "System.Tags=wayfinder:map"`. Its Notes / Decisions-so-far / Fog body go in `System.Description` via the markdown recipe.
- **Child ticket**: a `User Story` (or `Task`) linked to the map with `--relation-type parent`; tag `wayfinder:<type>`. Once claimed, `--assigned-to` the driving dev.
- **Blocking**: native `predecessor` link (above) — the UI-visible dependency. A ticket is unblocked when every predecessor is `Closed`/`Removed`.
- **Frontier query**: the unified frontier above.
- **Claim**: `az boards work-item update --id <n> --assigned-to "<email>"` — the session's first write.
- **Resolve**: post the answer with `--discussion "<answer>"`, set `--state "Closed"`, then append a context pointer to the map's Decisions-so-far (in the map's `System.Description`).
- **Asset**: research summaries/prototypes attach to the ticket, not the repo tree — add them as an attachment (`az boards work-item relation add --relation-type "attached file"`) or paste into a `--discussion` comment, then link from the map's Decisions-so-far. Delete the local working file once posted. The tracker is the source of truth — no local map mirror, no loose MD in the repo tree.
