# The bank keeps its own copy of the workspace helpers

**Status:** accepted

`src/lib/bank-closure.mjs` reads `pnpm-workspace.yaml`, parses its globs, walks
every `package.json` under them and builds a package index. So does
`@acme/workspace-graph`, the kernel the rest of the repo's checkers read the
same workspace through. The bank does not import it, and must not start.

**A future reader will find this duplication and try to remove it.** That is the
whole reason this file exists — the removal is a one-line import that passes
every gate in this repo and breaks every new consumer.

## Why

The bank runs before `pnpm install`.

A consumer's first contact with the bank is hand-copying four files into a repo
that has no `node_modules` — the wizard, the sync, and the two libs they share —
then running `setup:wizard` and the first `bank:sync` with bare `node`
([docs/bank.md](../../../../docs/bank.md)). There is no module resolution at
that moment. A bare specifier has nothing to resolve against, so
`import { … } from '@acme/workspace-graph'` fails before the derivation it was
meant to share ever runs.

`pnpm bank:sync` cannot be the bootstrap path either, because the root
`package.json` that defines it is itself one of the files the first sync
delivers. The command that installs the workspace arrives _from_ the bank; it
cannot be a prerequisite for reaching it.

Two escapes look available and are worse:

- **Import across packages by relative path.** `../../workspace-graph/src/…`
  needs no resolution, but it trips turbo's package-escape rule, and it makes
  the hand-copy set the bank plus an unbounded slice of a sibling package. The
  set a human copies has to stay small enough to name.
- **Grow the hand-copy set.** Shipping the kernel alongside the bank means a
  consumer copies two packages to run one command, and the kernel is
  TypeScript consumed through `tsx` — a dependency, which is the thing there is
  no install for.

So the duplication is the cost of the bootstrap, and the bootstrap is the
product: a repo that can be adopted from nothing is the claim the bank makes.

## What this does not license

The exemption is the bootstrap, not the package. What earns a copy is running
before `pnpm install`, and two things in here do:

- **Reading the workspace graph** — the glob parsing and the package index in
  `src/lib/bank-closure.mjs`, against the kernel the rest of the repo's
  checkers read the same workspace through.
- **The portable-token rule** — the scoped-name and shell-default patterns, the
  span arithmetic measured back from the closing brace, the scoped-name dedupe,
  the symlink skip and both derivations, in `src/check-bank-tokens.mjs`, against
  the copy that ships with `tooling/repo-checks`. That checker arrives with the
  first sync and runs in a repo where nothing is installed, so it is in the file
  list `src/tests/backend/bootstrap.test.ts` holds and the no-bare-import rule
  reaches it. The rule that forces the first copy forces this one.
  [0002-a-hyphen-is-a-word-boundary-and-what-that-forces.md](0002-a-hyphen-is-a-word-boundary-and-what-that-forces.md)
  is the rule itself.

Anything the bank does that does not run before install has no reason to be a
copy.

## Which copies may drift, and which must not

A forced copy is not a licence to disagree, and the two here are opposite cases.
Reading one as the other is how a checker goes quiet.

**The workspace pair may drift.** The two sides answer different questions. The
kernel serves checkers running in an installed workspace and can grow toward
that; this copy answers one question at a fetched git ref, on plumbing alone.
Keeping them identical is not a goal, and a diff between them is not a defect to
close.

**The token pair must agree.** Both halves enforce one rule — the same sentence
about what a distributed file may name — over the same content, and they are
split only because neither can import the other. A divergence there is not two
answers to two questions. It is one rule reporting differently depending on
which gate ran, and the half that went quiet is invisible in either copy,
because each reads as a complete and correct implementation on its own.

So that pair is held to **one set of cases rather than two suites written side
by side**. The cases are data — `src/tests/backend/portable-token-cases.json` —
and each carries the verdict both implementations owe it: the derived app tokens
and workspace scopes, the line-level shapes for the regexes, the span
arithmetic, the dedupe, and the symlink skip. This package's suite reads it as a
sibling, which is the only reach the no-bare-import rule leaves it; the
`tooling/repo-checks` suite reads the same file from the repo root and drives its
own functions with it. The corpus lives here for that reason, not because the
rule belongs here: the constrained side can reach nothing, so the data sits
beside it and the unconstrained side does the reaching.

One consequence is worth writing down, because it is easy to leave out and
silent when it is missing. A file outside the reading package is invisible to the
task graph that decides which suites re-run, so a case added here would leave the
other suite cached and green while it disagreed. The corpus is therefore named in
the root `turbo.json` as a global dependency: editing it re-runs everything,
which is the honest price of one file two packages are held to.

## How it is held

- `src/tests/backend/bootstrap.test.ts` asserts every runtime file in this
  package imports only `node:` builtins and its own siblings — the four
  hand-copied ones and the three that arrive with the first sync, since all
  seven share the same libs. That is the tripwire for the one-line removal
  above, and the list is why both duplications above are forced rather than
  only the first.
- The sibling suites run the real commands from a sandbox with nothing
  installed, so the constraint is exercised end to end rather than only
  asserted.
- The package declares no runtime dependencies at all. Everything in its
  `devDependencies` is lint, typecheck or test tooling, which never runs in a
  consumer repo.
- There is no build step, and none is available: `postinstall` builds
  `./packages/**`, and this package is outside it. A compile step here would be
  broken for the `pnpm lint` immediately after install.

## Consequence for the placement rule

[docs/agents/domain.md](../../../../docs/agents/domain.md#where-an-adr-lives)
said `tooling/*` may not own ADRs, because tooling decisions govern the
repo-wide gate rather than the config package. This is the first tooling
decision that fails that description and passes the deletion test instead:
delete `tooling/bank` and the reason for the duplication goes with it, because
the duplication goes with it. The rule now turns on the deletion test for
tooling packages too, rather than on the directory.
