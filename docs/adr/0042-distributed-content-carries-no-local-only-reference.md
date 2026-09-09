# Distributed content carries no reference that only resolves here

**Status:** accepted

A reference is content. When a comment in a vendored package says "see ADR 0029",
that sentence arrives in a consumer whose `docs/adr/0029` is a different decision
or no file at all. Dangling is the good case. The bad case is a number that
resolves to something plausible and wrong, and the reader has no way to tell.

This is a live defect here, not only in a consumer. ADR sequences are per
directory ([docs/agents/domain.md](../agents/domain.md#where-an-adr-lives)), so a
bare number is ambiguous the moment the host package owns a counter of its own.
Measured in content the bank distributes, excluding apps and docs:

| Class                                                             | Count |
| ----------------------------------------------------------------- | ----- |
| Bare `ADR NNNN` where the host package has that number, ambiguous | 102   |
| Bare `ADR NNNN` that can only mean a root ADR                     | 253   |
| `@acme/X ADR NNNN` cited from outside package X                   | 170   |
| Files carrying a GitHub issue reference                           | ~135  |

The first row is the one that costs something today. A reader of
`@acme/notifications` seeing `ADR 0001` in a comment cannot tell whether it means
that package's own seam decision or the root secrets-sync one, and nothing in the
text disambiguates it.

Issue numbers are worse than ADR numbers, because a consumer's tracker is
guaranteed to have a `#126` and it is guaranteed to be about something else.

## Decision

**No file the bank distributes carries a reference that resolves only here.**
Four classes, all of them structural.

**No bare ADR number.** A citation carries the path. The slug in the filename
names the decision, so the citation survives a renumber and says what it means
without being resolved.

**No ADR citation that resolves outside the citing package.** Stated precisely,
because the edges are what people get wrong:

- A package may cite its own ADRs.
- A package may not cite another package's.
- No distributed file may cite a root ADR.
- Root ADRs citing each other is fine, because they travel together.

The last two are one rule read from both sides: a citation may only point at
content that arrives whenever the citing file does. Everything under `docs/` is
one bundle, so a root ADR pointing at a root ADR, or at the agent protocol docs
beside it, always resolves. A package arrives without that bundle, so it may not
point into it. Where a genuinely repo-wide decision has to be cited from a
package, the pointer goes and the prose carries the constraint. Most of those
comments already state the reason in full, and the number adds nothing a consumer
can use.

**No GitHub issue number.** The number goes and the reason stays. Where the issue
is the only record of the reasoning, that reasoning is promoted into the comment
first, and only then is the reference deleted.

**No repo name, owner or app name outside a clearly marked example.** A
distributed file that names an app describes someone else's repo, and an agent
brief that grants autonomous issue writes against this repo's tracker is worse
than wrong. [docs/bank.md](../bank.md) is the one sanctioned exception and the
check allowlists it: it is addressed to a consumer about consuming this bank, so
naming the bank there is correct.

Under the last clause a root ADR cannot name an app, which is the mechanical
version of the placement rule. An app-layer decision has an app-layer home and
can no longer be filed at the root by accident.

## Considered and rejected

- **Keep bare numbers and restore a single global counter.** That is the
  collision the per-directory sequences were introduced to stop, and it makes
  every package's ADR numbering a function of what the root did last week.
- **Slug-only references, or a generated index.** Both are defensible and both
  are a bigger question than this. Path-bearing citations are the smallest change
  that removes the ambiguity, and they leave either option open.
- **Rewrite references during `bank:sync`.** A filter that strips or rewrites
  citations on the way out turns every touched line into a permanent conflict,
  because the consumer's copy differs from the bank's on a line neither side
  meaningfully edited. It is the same failure as renaming the `@acme` scope
  ([ADR 0038](0038-acme-scope-is-a-distribution-constraint.md)), and for the same
  reason: the merge base is the whole mechanism.
- **Document the rule and leave it unenforced.** Five hundred edits hold for
  about a week. `pnpm check:portable` is what makes this survive contact with the
  next comment somebody writes, and it ships, so a consumer's own content stays
  clean if they ever redistribute.
- **Sweep the app layer too.** Apps are consumer identity and the bank never
  distributes them, so their citations are free to name whatever they like.

## Consequences

- **Roughly five hundred edits over two hundred files**, landing as their own
  change with no behaviour in it. That sweep conflicts with everything, so it
  goes last and lands fast.
- **Root ADRs split three ways.** Decisions governing one package move into that
  package, where the citation becomes legal and travels with the code.
  App-layer decisions move under the app layer, which the bank already withholds.
  What stays at the root is the shape of the monorepo, which a consumer wants.
- **The root sequence gains gaps.** `check-adrs` warns and permits them, so
  nothing renumbers and no existing link breaks.
- **Reading a decision costs a path rather than a number.** Citations get longer.
  Accepted: the number was ambiguous in 102 places, and the path is not ambiguous
  anywhere.
- **The reasoning behind a removed reference has to be written down before the
  reference goes.** That is the expensive part of the sweep and the part worth
  doing.
- **The rule is agent protocol, not only an ADR.**
  [docs/agents/domain.md](../agents/domain.md) carries the four bullets, because
  that is where an agent looks before writing a citation rather than after a
  checker rejects one.
- **Two checks, in two places.** The four structural rules live beside the
  existing ADR check in `tooling/repo-checks`, inside `pnpm lint`, because they
  are repo-neutral. A token check for the repo name, the owner and app names
  lives in `tooling/bank`, because it only means anything in the bank.
