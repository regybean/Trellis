# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase, and the rules for writing to it. This file is canonical
for ADR placement, numbering and status, and for what a `CONTEXT.md` may hold —
every other surface links here rather than restating it.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- Per-package `docs/adr/` directories for context-scoped decisions. `CONTEXT-MAP.md` lists each package's own ADRs alongside the root ones that govern it.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context monorepo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                                   ← repo-wide decisions
├── packages/
│   ├── features/
│   │   └── chat/
│   │       ├── CONTEXT.md
│   │       └── docs/adr/                       ← chat's own decisions
│   └── shared/
│       └── ui/
│           └── docs/adr/                       ← ADRs, and no glossary
├── apps/
│   └── nextjs/
│       ├── CONTEXT.md
│       └── docs/adr/                           ← allowed; none today
└── tooling/
    └── test-utils/
        └── CONTEXT.md                          ← never an ADR directory
```

An ADR directory and a glossary are independent: a package may have either, both
or neither.

## Where an ADR lives: the deletion test

**If deleting the package would take the decision with it, the ADR belongs to
that package's `docs/adr/`. Otherwise it belongs to `docs/adr/` at the root.**
It is the test the repo already applies to code — a slice owns its schema, its
router and its UI because deleting the slice should take all three — so
reasoning and code are placed by one rule.

Citation counts are a tiebreak, never the rule. `docs/adr/0008-per-app-redis-namespace.md`
is cited only on the redis row of the context map, but the per-app namespace
survives deleting `@acme/redis` — so it stays at the root.

Two boundary cases:

- **Apps may own ADRs.** An app passes the same test. Nothing qualifies today:
  the app-shaped decisions on record each bind two or more apps, so they are
  repo-wide.
- **`tooling/*` may not.** A tooling ADR governs the repo-wide gate rather than
  the config package, so it stays at the root. The gate rejects a `docs/adr/`
  under `tooling/`.

Whether a given ADR is genuinely package-scoped is judgement. The gate checks
the mechanics around it, not the call itself.

## Numbering is per directory

Each directory owns its own sequence, starting at `0001`. Root and package
numbering are independent, and **the same number in both is normal** — never flag
it. One counter with more than one author is what collided three root numbers
before this rule existed.

To pick the next number, scan the directory you are writing into for the highest
one and add one. A **gap** in a sequence is expected: it is the trace of a
deleted ADR, and renumbering to close it would break every citation. The gate
warns on a gap and passes.

Filenames are `NNNN-kebab-slug.md`.

## Status is `accepted` or `amended by <path>`

Every ADR carries a status on the line under its title:

```md
# The decision, stated as a sentence

**Status:** accepted
```

Two values, and a trailing note is allowed after either (which ticket, or what
the amendment changed):

- **`accepted`** — the decision stands.
- **`amended by <relative-path>`** — a later, separable ADR changed part of this
  one's decision. The path must resolve.

`superseded by` is rejected by the gate, because a superseded ADR is deleted
rather than kept. Keep the prose blockquote that explains _what_ changed — one
word cannot carry that — beside the status line, not instead of it.

## When a decision changes

- **Amend the ADR in place** when the decision itself changed. An ADR is not an
  append-only record here; the reasoning behind a reversal survives in git.
- **Write a new ADR** only when the new decision is separable from the old one.
  Then set the old one's status to `amended by <the new ADR>`.
- **Delete a superseded ADR.** No tombstones, no archive directory: a stub at the
  root is the clutter this layout removes, and it would collide with a future
  number.

## What "stale" means

Superseded, or never built. **Not** "the vendor named in it is gone."
`docs/adr/0003-framework-agnostic-auth-seam.md` is full of mentions of a
departed auth provider, but auth-injected-into-the-context is the live
architecture — deleting it removes the only explanation of why
`createTRPCContext` takes injected auth. Same for
`docs/adr/0011-remove-compositions-layer.md`, which is why a
`packages/compositions/` PR gets rejected. Rewrite the departed vendor out of the
prose if you like; don't delete the file.

## `CONTEXT.md` is a glossary

A glossary and nothing else. No design decisions, no ADR references in the body —
including inside a term's definition. The shape:

```md
# <Context> (`@acme/<package>`)

One or two lines on what this context is and why it exists.

## Language

**Term**:
What it means here.
_Avoid_: the synonyms this context doesn't use

## Relationships

How this context relates to its neighbours.

## Decisions

See `docs/adr/`.
```

A design-decision block in a `CONTEXT.md` is the failure this shape prevents:
several of them used to amend root ADRs in prose, so for those decisions the
current state existed only as the difference between two files.

When triaging prose that has accumulated in one, each block does exactly one of
three things:

- **Becomes an ADR** — it is hard to reverse and explains why the code is the way
  it is. Place it by the deletion test.
- **Edits an existing ADR in place** — it amends a decision recorded elsewhere.
  Fold it in; don't write a new ADR.
- **Gets deleted** — it restates what the code already says.

## The code is the source of truth

Prose that restates what a reader could get from the code in under a minute is
deleted rather than relocated. A decision is something hard to reverse that
explains why the code is the way it is. Bias toward cutting.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR 0007 (description) — but worth reopening because…_

## What the gate enforces

`scripts/check-adrs.mjs` runs inside `pnpm lint`. It **fails** on:

- two ADRs sharing a number inside one directory;
- a dead ADR reference anywhere — an ADR, a `CONTEXT.md`, the context map, a doc,
  a lint message, a script comment;
- a missing or invalid status, including any file declaring `superseded by`;
- a package owning a `docs/adr/` with no `CONTEXT-MAP.md` row;
- a `docs/adr/` under `tooling/`.

It **warns** on a sequence gap, and never flags a number reused across two
directories.
