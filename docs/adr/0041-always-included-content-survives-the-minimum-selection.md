# Always-included content survives the minimum selection

**Status:** accepted

The smallest selection the mechanism allows is `packages: []`, `bundles: []`.
That resolves to the always-included bundles and nothing else, because
`alwaysIncluded` is a property of the bundle rather than a choice the manifest
makes ([ADR 0039](0039-the-selection-is-the-contract.md)). Today that is
twenty-five paths and a hundred and seventy-two files.

A consumer took exactly that and needed fifteen local deviations to reach a green
gate. Roughly half were divergence a consumer should own forever. The other half
were places the bank shipped required content that only works here:

- Two of the scripts in `scripts/` imported six optional packages by relative
  path, so `pnpm dev` and `pnpm infra:up` failed out of the box. Two more
  hard-coded a feature package by name.
- `scripts/link-agent-docs.sh` exits 1 when the canonical agent brief is absent.
  It runs on `postinstall` inside a `set -euo pipefail` chain, so a consumer
  without the agents bundle could not complete a first `pnpm install` at all.
- `scripts/dev.sh` matched container names against a literal prefix belonging to
  this repo, so infra log mirroring did nothing and wrote empty
  `logs/infra-*.log` with no error.
- `scripts/lib/secrets-env.sh` requires `secrets.config.sh`, which is on
  `exclude` and which no bundle ships a substitute for, so `pnpm env:pull`
  failed naming a file the consumer had no way to know the shape of.
- Three vendored test suites asserted against apps only this repo has.

[`bank.paths.json`](../../bank.paths.json) already argues the outbound half of
this carefully: anything the root `package.json` _invokes_ has to travel with it,
which is why six `tooling/*` packages are always included even though the package
derivation already offers them. Nothing stated the inbound half. Anything
required content _imports_, _filters on_ or _requires_ has to be optional,
because the selection that omits it is a supported one.

The cost is not a bug that fires once. Every one of those deviations forced the
consumer to keep its own version of a distributed file. That file is now the
local side of a three-way merge and re-raises the same conflict on every future
sync, for every consumer, forever.

## Decision

**Content in an always-included bundle works under the minimum selection, or it
fails visibly at the point the consumer asked for it.** Never silently, and
never during `postinstall`.

Three clauses, then a distinction the first one needs.

**It reaches only what the always-included set delivers.** No relative import
into an optional package, no hard-coded optional package name to filter on, no
required file no bundle ships. Where required content genuinely needs to know
about optional content, it discovers what is present rather than naming what it
expects. `@acme/workspace-graph` already derives the closure, so a script that
asks the graph gets whatever the consumer took, and a consumer's own packages
are included for free.

The set is whatever carries the `alwaysIncluded` flag, not a bundle with a
particular name. How that content is grouped is a question about explaining the
inventory; the rule holds however it is grouped, and holds across group
boundaries, since a consumer receives all of it or none of it.

**Where it cannot work, it fails at the command that needed it.** Someone typing
`pnpm env:pull` with no secrets config should get exit 1 naming the file to
create. They asked for the thing that is missing, so refusing is the correct
answer and the only question is whether the message is actionable.

**A hook nobody invoked exits 0 and says why.** A `postinstall` step about
content the consumer never selected must not fail, because a repo whose first
`pnpm install` fails is a repo that cannot be installed.
`scripts/sync-claudeignore.mjs` already sets that precedent and the agent-doc
linking follows it. The refusal itself stays correct when someone runs the script
directly.

Silence is the worst case of all three. Zero matching containers writes a line
to stderr, because an empty log file is not a diagnosis.

**A manifest entry is not a script body.** The root `package.json` may keep a
script entry naming a package a consumer does not have. It is one line, the
consumer can delete it, [docs/bank.md](../bank.md) says which lines and why, and
`turbo` answers "no projects matched" rather than doing something wrong. A
script _body_ naming an optional package has no line to delete and nothing
pointing at it. The existing bootstrap suite already sanctions the dangling
manifest filter on those grounds; this ADR draws the same line one level down.

## Considered and rejected

- **Make each named input optional.** The scripts keep their relative imports
  into `packages/` and wrap each one in a presence check. The coupling stays,
  every new slice with infra still edits a tooling package and a script, and the
  imports become conditional, which no static rule can then assert against.
  Discovery removes the imports instead of guarding them.
- **A second always-included bundle for whatever required content reaches
  into.** This is the minimum selection growing until it is the whole repo, and
  it inverts nothing: the bundle becomes the hand-written list of packages the
  scripts know about. Grouping the required content by subject is worth doing
  for readability, but no grouping makes an optional package required.
- **Per-path exclusion inside a bundle**, so the vendored suites could be
  withheld. That is a change to the sync mechanism, since a resolved path is a
  prefix. Deriving the subject where the assertion allows it, and skipping with
  a stated reason where it does not, costs nothing and keeps the suites honest
  here too.
- **Materialise the minimum tree in CI and run its gate.** The most truthful
  check available and the slowest. A rule derived from `bank.paths.json` covers
  the same family statically, and the bootstrap suite already holds two
  portability invariants derived that way.
- **Write the deviations down in `docs/bank.md` instead.** That is the status
  quo with instructions attached. The consumer still edits fifteen distributed
  files and still owns fifteen permanent merge conflicts.

## Consequences

- **Ownership of dev infra inverts.** A package that declares an infra profile
  declares what that profile contributes and what it needs seeded. The scripts
  pass nothing and name no feature. Adding a slice with infra stops touching a
  tooling package or a script.
- **A test derived from `bank.paths.json` enforces the reach rule**, so the next
  relative import from required content into `packages/` fails here rather than
  in a consumer's install. It reads the `alwaysIncluded` flag rather than a
  bundle name, so it keeps holding as the inventory is regrouped.
- **The minimum selection is a supported configuration.** Someone has to keep it
  working, and that is the point: a consumer can start with nothing selected and
  grow.
- **An error message is now part of the contract.** For the content that
  legitimately cannot work without optional content, the message naming what is
  missing is the deliverable, not a nicety.
- **The compose environment builder stops throwing when no profile selects an
  ollama role.** Under discovery, absent means absent rather than fatal.
- **A consumer that redistributes inherits the rule**, because the check that
  enforces it ships in the bank.
