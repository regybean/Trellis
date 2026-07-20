# Agent workflow

Trellis is built to be navigated and _extended_ by coding agents as much as by humans. This is the overview of how that works; each linked doc is the detail.

## The core loop: plan → build in parallel → human reviews

The intended flow for substantial work is a planning skill, then isolated build agents, with a **human making the engineering decisions** at both ends:

1. **Plan — `/grill-with-docs`.** A grilling session that stress-tests a plan against the repo's _existing domain language_ and documented decisions. It challenges fuzzy terms against the package `CONTEXT.md` files, cross-references the code, and **updates `CONTEXT.md` / writes ADRs inline** as decisions crystallise — so the documentation keeps pace with the design instead of lagging it. (This very document set was produced through it.)
2. **Build in isolation — `/implement`.** Once the plan is settled, each task runs in its own git **worktree**, one window per task, so **multiple agents work at once without stepping on each other** — no central orchestrator, independence is the feature. `/implement` builds it step-by-step and pushes a PR. See [worktree-workflow.md](worktree-workflow.md) for the mechanics and [dev-flow.md](dev-flow.md) for the full step-by-step relay (which skill, which model, where to compact).
3. **Human in the loop.** Each window is interactive: the agent _asks_ whether to build in a worktree only _after_ the plan exists and scope is clear, and **never auto-merges** — the human reviews the diff in the VSCode GitHub Pull Requests extension and decides. Engineering judgement stays with the human; agents do the legwork in parallel.

```
        ┌─ window 1 ─ claude --worktree ─ /grill-with-docs ─→ /implement ─→ PR ─┐
human ──┼─ window 2 ─ claude --worktree ─ /grill-with-docs ─→ /implement ─→ PR ─┼─→ review & merge
        └─ window 3 ─ claude --worktree ─ /grill-with-docs ─→ /implement ─→ PR ─┘
         (parallel, isolated worktrees)                    (human decides)
```

## How agents read this repo

Before exploring, agents consult the repo's own documentation — domain language first, decisions second:

- [**CONTEXT-MAP.md**](../../CONTEXT-MAP.md) — index of per-package `CONTEXT.md` files (the ubiquitous language).
- [**docs/adr/**](../adr/) — architectural decision records: the choices that are hard to reverse and would otherwise be surprising.
- [**domain.md**](domain.md) — how the skills should consume the above when exploring.
- [**feature-anatomy.md**](feature-anatomy.md) — how a `packages/features/*` package is laid out: the slice contract, the two contracts (procedure / hook), exports, and the test taxonomy.
- [**testing.md**](testing.md) — how tests work: the unit / integration(api·service) taxonomy, the frontend doctrine ([ADR 0018](../adr/0018-frontend-test-doctrine.md)), "test the contract not the internals", and the mocking rules (full detail in [docs/TESTING.md](../TESTING.md)).

## Tracking work

- [**issue-tracker.md**](issue-tracker.md) — where issues and PRDs live and how skills read/write them (`/to-spec`, `/to-tickets`, `/triage`).
- [**triage-labels.md**](triage-labels.md) — the five canonical triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) mapped to this repo's labels.

## The skills

Skills are **vendored** into `.agents/skills/` (committed; pinned by [skills-lock.json](../../skills-lock.json), sourced from `mattpocock/skills` and `mastra-ai/skills`). Claude only discovers a skill once it's symlinked into `.claude/skills/` — which is gitignored, so the symlinks don't survive a clone. [`scripts/register-skills.sh`](../../scripts/register-skills.sh) recreates them idempotently and runs on `postinstall`; run **`pnpm skills:register`** manually after adding or removing a skill.

**Skills stay code-agnostic.** A skill describes _what_ to do and delegates the
_how_ — concrete commands, script paths, tool names, file layouts — to
`docs/agents/*` (and `CONTEXT.md` / ADRs), which it links out to. The skills are
vendored and shared across repos; baking this repo's specifics into them breaks
that portability and lets the docs and skills drift. So when a step needs a
repo-specific mechanic, put the mechanic in the doc and have the skill reference
it (as `/implement` cites [worktree-workflow.md](worktree-workflow.md),
[quality-gate.md](quality-gate.md), [pull-requests.md](pull-requests.md)).

The load-bearing ones for the loop above:

| Skill                            | Role                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `/grill-with-docs`               | Plan: stress-test against domain language, update `CONTEXT.md` + ADRs inline |
| `/implement`                     | Build the agreed plan in an isolated worktree → PR                           |
| `/to-spec`, `/to-tickets`        | Turn context into a spec / break a plan into grabbable tickets               |
| `/triage`                        | Move issues through the triage state machine                                 |
| `/improve-codebase-architecture` | Find deepening/refactoring opportunities, informed by `CONTEXT.md` + ADRs    |
| `/mastra`                        | Mastra framework reference for the RAG/agent work                            |

See [CLAUDE.md](../../CLAUDE.md) for the full agent brief and the layer-boundary rules agents must respect.
