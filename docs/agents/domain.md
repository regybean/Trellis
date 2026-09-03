# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context, and lists both the ADRs each package owns and the root ones that govern it. Read each row relevant to the topic.
- **`docs/adr/`** — repo-wide decisions that touch the area you're about to work in.
- The package's own **`docs/adr/`** — its decisions travel with it.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context monorepo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                                   ← repo-wide decisions
├── packages/
│   ├── features/
│   │   ├── chat/
│   │   │   ├── CONTEXT.md
│   │   │   └── docs/adr/                       ← chat's own decisions
│   │   └── <other-feature>/
│   │       ├── CONTEXT.md
│   │       └── docs/adr/
│   └── shared/
│       └── <package>/
│           ├── CONTEXT.md
│           └── docs/adr/
└── apps/
    ├── nextjs/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    └── <other-app>/
        ├── CONTEXT.md
        └── docs/adr/
```

## Where an ADR lives

**Placement is the deletion test.** If deleting the package would take the
decision with it, the ADR belongs in that package's `docs/adr/`. Otherwise it
belongs at the root. It is the same test the repo already applies to code, so
there is one rule for both. Citation counts are a tiebreak, never the rule: an
ADR cited only on one package's row can still survive deleting that package, and
then it stays at the root.

**Apps may own ADRs; `tooling/*` may not.** An app passes the same test, though
nothing qualifies today. Tooling decisions govern the repo-wide gate rather than
the config package, so they stay at the root.

**Sequences are per directory, starting at `0001`.** Root and package numbering
are independent — the same number in both is normal and is never flagged. A
package owns its counter; the root owns its own. That is what stops the
collisions a single global counter kept producing.

**Gaps are fine; renumbering is not.** A gap is the honest trace of a deletion.
Closing it would re-break every link that points past it, so `check-adrs` warns
and passes.

**Every package owning a `docs/adr/` has a `CONTEXT-MAP.md` row.** A `CONTEXT.md`
is not required — an ADR directory and a glossary are independent.

## Status, amendment and deletion

Every ADR carries a `**Status:**` line directly under its title, with exactly two
permitted values:

```md
**Status:** accepted
**Status:** amended by <relative-path-to-the-amending-adr>
```

Either may be followed by a free-prose note (` — <note>`, or a parenthetical).

**`superseded by` is not in the vocabulary, and the gate rejects it.** A
superseded ADR is _deleted_, not archived — the reasoning behind a reversal
survives in git rather than in the tree. The consequence is accepted
deliberately: an ADR is not an append-only record.

**When a decision changes, edit the ADR in place.** Write a new ADR only when
the new decision is separable from the old one; then the old one's status becomes
`amended by <path>` and it keeps the blockquote explaining _what_ changed, which
one word cannot.

**"Stale" means superseded or never-built — not "the vendor is gone".** An ADR
that names a departed vendor throughout may still be the only explanation of why
the code is shaped the way it is. Rewrite the vendor out of the prose if you
like; do not delete the file.

## `CONTEXT.md` is a glossary and nothing else

A `CONTEXT.md` holds a title, a short intro, `## Language`, `## Relationships`,
and one closing `## Decisions` line pointing at `docs/adr/`. No design-decision
prose, and no ADR references in the body — including inside term definitions.

**The code is the source of truth.** Prose that restates what a reader could get
from the code in under a minute is deleted rather than relocated. A decision is
something hard to reverse that explains _why_ the code is the way it is.

## What the gate enforces

`scripts/check-adrs.mjs` runs inside `pnpm lint` and as its own
`pnpm quality-gate` stage. It fails on a duplicate number within a directory, a
dead ADR link anywhere in the repo, a missing or out-of-vocabulary status, and a
package owning ADRs with no `CONTEXT-MAP.md` row. It warns on a sequence gap.

Whether an ADR is _genuinely_ package-scoped is judgement. It stays documented
here rather than enforced.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts `docs/adr/0007-package-test-policy.md` — but worth reopening
> because…_

Name the ADR by **path**, not by number alone: numbers are per directory, so
`0007` is ambiguous across the repo.
