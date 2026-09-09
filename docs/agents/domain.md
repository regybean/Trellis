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

**Apps and tooling packages may own ADRs — the deletion test decides, not the
directory.** An app passes the same test, though nothing qualifies today. A
`tooling/*` config package almost never does: its decisions govern the
repo-wide gate rather than the package, so they stay at the root. `tooling/bank`
is the standing exception — the bank's duplicated workspace helpers exist
because it runs before `pnpm install`, and deleting the package takes both the
duplication and the reason for it
([its ADR 0001](../../tooling/bank/docs/adr/0001-the-bank-keeps-its-own-workspace-helpers.md)).

**Sequences are per directory, starting at `0001`.** Root and package numbering
are independent — the same number in both is normal and is never flagged. A
package owns its counter; the root owns its own. That is what stops the
collisions a single global counter kept producing.

**Gaps are fine; renumbering is not.** A gap is the honest trace of a deletion.
Closing it would re-break every link that points past it, so `check-adrs` warns
and passes.

**Every package owning a `docs/adr/` has a `CONTEXT-MAP.md` row.** A `CONTEXT.md`
is not required — an ADR directory and a glossary are independent.

## How to cite an ADR

Most of this repo is distributed to other repos, and a citation is content like
anything else. A number that resolves to a different decision in the reader's
tree is worse than no citation at all, so the rule is about _where_ the target
sits, not only how you spell it
([ADR 0042](../adr/0042-distributed-content-carries-no-local-only-reference.md)).

**A citation carries the path, never a bare number.** `0007` alone is ambiguous:
sequences are per directory, so it names the root decision and every package
decision numbered `0007` at once. Write
`docs/adr/0007-package-test-policy.md`, as a link where the format allows one.
The slug says which decision you meant even when nobody follows the link.

**Four rules decide whether the citation is allowed at all.**

- A package may cite its own ADRs.
- A package may not cite another package's.
- No distributed file may cite a root ADR.
- Root ADRs citing each other is fine, because they travel together.

The last two are one rule: point only at content that arrives whenever the citing
file does. Everything under `docs/` is one bundle, so a root ADR may cite a root
ADR or a doc beside it, and this file may cite both. A package is selectable on
its own, so it may cite nothing outside itself.

**When the rule forbids the citation you wanted, write the reason instead.** A
comment that has to lean on a repo-wide decision states the constraint in prose.
That is usually one extra sentence, and it is the sentence a reader in another
repo actually needs.

The same applies to issue references. Don't put one in a file the bank
distributes; put the reasoning in.

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

`tooling/repo-checks/src/adrs.ts` runs inside `pnpm lint` and as its own
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

Name it the way [How to cite an ADR](#how-to-cite-an-adr) says: by path, never by
number alone.
