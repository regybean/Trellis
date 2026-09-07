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

A consumer's first contact with Trellis is hand-copying six files into a repo
that has no `node_modules`, then running `setup:wizard` and the first
`bank:sync` with bare `node` ([docs/bank.md](../../../../docs/bank.md)). There is
no module resolution at that moment. A bare specifier has nothing to resolve
against, so `import { … } from '@acme/workspace-graph'` fails before the
derivation it was meant to share ever runs.

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

This is the **only** duplication the reorganisation preserves, and it is scoped
to reading the workspace graph — the glob parsing and the package index in
`src/lib/bank-closure.mjs`. It is not a general exemption for this package.
Anything the bank does that does not run before install has no reason to be a
copy.

The constraint has a consequence worth stating: **the two copies are allowed to
disagree.** The kernel serves checkers running in an installed workspace and can
grow toward that; this copy answers one question at a fetched git ref, on
plumbing alone. Keeping them identical is not a goal, and a diff between them is
not a defect to close.

## How it is held

- `src/tests/backend/bootstrap.test.ts` asserts every hand-copied file imports
  only `node:` builtins and its own siblings. That is the tripwire for the
  one-line removal above.
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
