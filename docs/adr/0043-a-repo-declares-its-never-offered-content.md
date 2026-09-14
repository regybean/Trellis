# A repo declares its never-offered content, and the exemption is per rule

**Status:** accepted

[ADR 0042](0042-distributed-content-carries-no-local-only-reference.md) made the
four portability rules structural so they ship with the checker and keep a
consumer's own content clean. They do ship, and they are structural. What they
cannot be told is that part of a consumer's tree is the consumer's own work.

So every rule runs over everything, and downstream a consumer's own slices are
most of the tree. The first run there is a four-figure report, the bulk of it in
packages nobody outside that repo has ever seen. The findings that cost
something are in it somewhere.

The two exemptions 0042 sanctions are both about the bank's shape rather than
the consumer's. `apps/` generalises correctly — every repo has one and nobody
receives it. `NOT_DISTRIBUTED` is six paths of this repo's own front matter and
indexes. Neither can say "this whole package is mine".

## Decision

**A repo declares its never-offered directories, in a constant, and the
exemption applies per rule rather than per directory.**

`NEVER_OFFERED` sits beside `NOT_DISTRIBUTED` in the checker: repo-relative
directory prefixes, each mapped to the reason it was never on offer. It is empty
here, because everything this repo holds outside `apps/` is content it offers.

Three things the mechanism fixes about itself:

- **Matched at the separator.** A declaration of `packages/features/foo` covers
  that directory and never the sibling `packages/features/foobar`.
- **A blank reason fails the gate.** The list changing has to be something a
  reviewer reads, not a prefix appearing.
- **A prefix matching no directory fails the gate.** An exemption left behind by
  a rename covers nothing while reading as though it still does, and nobody
  finds out from a passing check.

**Rule 3 consults it. Rules 1, 2 and 4 do not.** The four rules do not share a
harm model, and the axis that separates them is where the harm lands:

| Rule                               | Harm                                    | Lands         | Consults |
| ---------------------------------- | --------------------------------------- | ------------- | -------- |
| 1. No bare ADR number              | the number names two decisions at once  | here          | no       |
| 2. No citation outside the package | the target does not travel              | a second repo | no       |
| 3. No bare issue number            | resolves to something else there        | a second repo | yes      |
| 4. No root document naming an app  | mis-filed, and a claim about other apps | here          | no       |

**Rule 3's harm needs a second repo.** A number alone is resolved by whichever
tracker the reader happens to be looking at. In a package nobody else ever
receives there is no other reader, so the number means here exactly what it
says.

**Rule 1's harm is in the citing checkout.** ADR sequences are per directory, so
a bare number is ambiguous the moment the host package owns a counter of its
own, with no redistribution involved anywhere. 0042 counted that class at 102
citations in this repo. A package being nobody else's does nothing about it.

**Rule 2 abstains, and it is the close one.** Read only as travel, its harm
patterns with rule 3 and it would consult the constant. But the fix it prints
offers moving the decision into the citing package as well as rewriting the
citation, and that half is placement: a root decision governing one package is
mis-filed in the declaring repo's own tree, which is 0042's own consequence
about root ADRs splitting three ways. A rule left on can be switched off later
against evidence. One switched off silently stops producing the evidence.

**Rule 4 abstains, where the question is nearly moot.** It runs only on
documentation belonging to no package, and this constant names packages. Where
the two could meet — a consumer declaring a documentation directory of their
own — rule 4's mis-filing half lands on their readers, same as rule 1.

## Considered and rejected

- **One whole-directory exemption covering all four rules.** A few lines
  shorter, and it silences rule 1 in the one repo where rule 1 is right. The
  exemption is about **origin**; three of the four rules are not.
- **A general "is this distributable?" predicate.** That answer lives in
  `bank.paths.json`, one tooling package away, and a consumer has no inventory
  at all — so the rule would go quiet exactly where it is meant to keep working.
  0042 already refuses this and the refusal is unchanged.
- **Reading the inventory's `exclude` list.** Worse than the above: `exclude`
  moves for reasons that have nothing to do with origin, and the rule acquires a
  trapdoor that opens whenever something is withheld. 0042 rejected the same
  thing for `NOT_DISTRIBUTED`.
- **Deriving it from `private: true` in a manifest.** Not the same question.
  Plenty of never-published packages are still offered, and the flag is about
  the npm registry rather than about who wrote the code.
- **A per-file list, like `NOT_DISTRIBUTED`.** The unit downstream is a package,
  and a consumer's is hundreds of files. A list that has to name each one is a
  list nobody maintains.

## Consequences

- **A consumer's local delta reduces to the contents of one constant.** Until
  now the checker was vendored and edited downstream, so the same conflict
  re-raised on every sync. The constant is the one place their list belongs.
- **Nothing changes in a repo that declares nothing.** The constant is empty
  here, so every rule behaves exactly as before, and this repo's own run is
  unaffected.
- **A declaration silences one rule, not the report.** Rules 1 and 2 stay loud
  over a declared package and rule 4 never ran there. Someone who expected
  silence will go to the constant to find out why, which is where the reasoning
  is.
- **Rule 2 is the one to revisit.** If a consumer's report is dominated by
  rule 2 findings inside declared packages, the argument above is the thing to
  weigh against that evidence, and flipping it is a one-line change.
- **The checker now fails on its own configuration.** A stale or unexplained
  entry is a gate failure rather than a quiet no-op, which is the only moment
  anybody is looking at the list.
