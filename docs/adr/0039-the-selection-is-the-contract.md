# The selection is the contract: neither side of the bank enumerates paths

[ADR 0037](0037-vendored-git-subset-three-way-merge.md) gave the bank a
distribution mechanism and left two hand-written lists behind it. The bank listed
its own packages in `bank.paths.json` — 26 entries of name, path and layer. Each
consumer listed the paths it took in its manifest's `include`.

Both lists were wrong in the same way. `bank.paths.json`'s array was exactly the
set the `pnpm-workspace.yaml` globs already matched, so it selected nothing and
could only drift; a package added, moved or renamed left it stale, which is the
failure the file was written to end (#254). And a consumer's `include` was a
closure snapshotted at authoring time: the first time an upstream package gained
a workspace dependency, the consumer's vendored tree stopped installing, and the
error arrived at `pnpm install` rather than at the manifest that caused it.

## Decision

**Neither side enumerates paths.** The bank's package set is derived, and the
consumer's `include` is resolved.

**The bank derives its package set.** It is every workspace package the
`pnpm-workspace.yaml` globs match, minus anything under `bank.paths.json`'s
`exclude` — which is how `apps/*` stays out without anything naming it twice.
The `packages` array is gone. `bank.paths.json` keeps the two things that cannot
be derived: `bundles`, the named groups of content that cannot be a package
because the tools that read it require it at a fixed repo-relative path, and
`exclude`, the withheld paths with a reason each.

**A consumer's manifest records a selection**, never paths:

```json
{
  "upstream": "https://github.com/regybean/Trellis.git",
  "ref": "bank/2026-08-26",
  "packages": ["@acme/billing"],
  "bundles": ["docs"],
  "omit": [],
  "contributable": []
}
```

`include` is not a field. A manifest that still has one is refused with the
migration named, rather than resolving an empty selection and syncing almost
nothing.

**`bank:sync` resolves the selection at the pinned ref.** It reads
`pnpm-workspace.yaml`, every `package.json` under the globs, and
`bank.paths.json` out of the fetched tree with `ls-tree` and `cat-file`, builds a
name-to-path index, walks workspace dependencies to the transitive closure,
unions the selected bundles' paths, and adds `infra` when a closure member
declares `acme.infra` — the same convention `scripts/resolve-infra.ts` follows.
No install, no pnpm, no turbo: the sync already ran entirely on plumbing, and so
does this.

Four properties follow from resolving rather than authoring.

**Names, not paths.** A directory move upstream is followed automatically,
because the selection names `@acme/ui` and the path is looked up at `ref`.

**A missing name is a hard error.** A selected package that does not resolve at
`ref` aborts the sync naming it, before anything is written. Silently dropping a
package the consumer imports turns a manifest problem into a build error three
steps later.

**Omission is explicit.** `omit` subtracts paths after resolution, empty by
default, warning per entry that the resulting tree will not install unaided. It
is the substitution case: a consumer keeping its own logger or auth. It is called
`omit` rather than `exclude` so the bank's `exclude` keeps its one meaning in the
file beside it.

**The closure delta is visible before the bump.** `--check` resolves at both
`pinned` and `head` and names the paths entering and leaving, so "bumping to the
new tag also brings `@acme/icons`, which `@acme/ui` now depends on" is read
beforehand rather than discovered when the install fails. It belongs to the
existing **behind** outcome and its exit code 2: the closure only moves when
`ref` moves, so it is never independent news.

**A gate keeps the root honest.** Derivation covers the package tree and nothing
else, so a new root-level file is invisible to it. `scripts/check-bank-paths.mjs`
runs in `pnpm lint` and fails when a tracked root-level entry is in neither a
bundle nor `exclude`. It enumerates with `git ls-files`, so the untracked working
dirs (`.cache`, `.turbo`, `logs`, `node_modules`) never reach it, and it accepts
nesting in either direction, since `scaffolding` names `turbo/generators` while
the root entry is `turbo`.

## Considered and rejected

- **Keep `packages` and add an opt-out flag.** A flag would earn the array back,
  but nothing needs one today: every workspace package outside `apps/*` is on
  offer. A list kept for a hypothetical is a list that drifts for a certainty.
  Add the flag when a package needs it, and the array with it.
- **Resolve the closure at authoring time** (a wizard writing a flat `include`).
  That is the status quo with better ergonomics: correct the day it is written
  and stale on the next upstream dependency edit. Resolution has to happen at the
  ref, which means at sync time.
- **`pnpm ls --only-projects` for the graph**, as `scripts/resolve-infra.ts`
  does. It needs a checkout and an install. The bank being resolved is a fetched
  tree in the object store, so the walk has to run on plumbing.
- **A fourth `--check` exit code for a closure change.** The closure is a pure
  function of the selection and the ref, so it can only move when `ref` does — it
  is never news independent of **behind**.
- **Deriving the exclusions too**, from `.gitignore` or a naming rule. `exclude`
  carries _why_ a path is withheld, and every reason on it is a judgement about
  consumer identity that no rule expresses.

## Status

accepted

Implements [#267](https://github.com/regybean/Trellis/issues/267), and supersedes
in part [ADR 0037](0037-vendored-git-subset-three-way-merge.md) — the mechanism
stands unchanged; what a manifest holds and what `bank.paths.json` lists do not.

It also shrinks [#240](https://github.com/regybean/Trellis/issues/240), the setup
wizard: with the package set derived and the closure resolved at sync time, the
wizard owns no closure resolver, no gate check and no `include` authoring. What
is left is a picker over a derived list that writes `packages` and `bundles`.

## Consequences

- **`bank.paths.json` is read at the bank ref, not off the consumer's disk**, so
  it is on `exclude`. Vendoring it would put a second, always-staler copy in a
  repo that already reads the authoritative one.
- **The bank must carry a `pnpm-workspace.yaml` at every ref a consumer pins.**
  It is in the `root` bundle already, and the resolution fails naming it if a ref
  predates it.
- **A `pnpm-workspace.yaml` rewrite is a distribution change.** Moving a package
  out of the globs removes it from the bank, silently, with no edit to
  `bank.paths.json` at all. That is the point of deriving, and it is the one
  place where the derivation makes a mistake cheap to make.
- **Adding a package needs no bank edit.** Adding a root-level _file_ does, and
  the gate says so at `pnpm lint` rather than at a consumer's install.
- **Resolution costs one `ls-tree` plus one `cat-file` per package**, twice for
  `--check`. Tens of git invocations against the object store, on a command that
  already fetches over the network.
