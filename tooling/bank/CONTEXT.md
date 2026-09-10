# Bank (`@acme/bank`)

The distribution mechanism: the three commands a consumer runs to take this
repo's packages into their own and to send changes back, plus the gate that
keeps this repo's inventory of itself honest.

- `src/setup-wizard.mjs` — authors `bank.manifest.json`. Copies nothing.
- `src/bank-sync.mjs` — the pull half. Resolves the manifest at the pinned ref
  and writes the vendor branch.
- `src/bank-contribute.mjs` — the guarded back-flow. Invoked by no automation,
  ever, and a test asserts it.
- `src/check-bank-paths.mjs` — fails `pnpm lint` when a tracked root-level entry
  is in neither a bundle nor `exclude`.
- `src/check-bank-tokens.mjs` — fails the gate on distributable content that
  names this repo, its owner or one of its apps. It lives here rather than in the shared
  lint because only the bank knows those three words: the inventory says what is
  distributable, and git says what this repo is called. `docs/bank.md` is
  allowlisted — it is addressed to a consumer about consuming this repo, so
  naming it there is correct.

The model is a vendored subset merged three ways, with neither side enumerating
paths. The consumer-facing guide is [docs/bank.md](../../docs/bank.md).

**This package is plain `.mjs` on `node:` builtins, with no build step and no
runtime dependencies.** It runs hand-copied into a repo that has installed
nothing, which is why it keeps its own copy of the workspace-graph helpers
rather than importing the shared kernel — see
[ADR 0001](docs/adr/0001-the-bank-keeps-its-own-workspace-helpers.md) before
removing that duplication.

The root delegates every command here with `pnpm -C tooling/bank`, so
`tooling/bank` rides the always-included `delegated-tooling` bundle in
`bank.paths.json`: a consumer who never selected this package by name still
receives it, because otherwise their next sync would delete the tool that
performs the one after it. The four config packages this one declares
`workspace:*` on ride `config-closure`, which is always-included for that
reason alone — a bundle contributes paths and never walks dependency edges, so a
manifest one delivers has to name only packages the always-included set
delivers.

`-C` rather than `--filter` is deliberate, and not for the reason it looks like:
on the pinned pnpm both spellings pass the child's exit code through, so
`bank:sync --check`'s drift code survives either way. What separates them is the
missing-package case. `--filter` on a name no package matches prints "No
projects matched the filters" and **exits 0** — so in a repo whose bank never
arrived, `pnpm bank:sync --check` would report no drift while doing nothing at
all, which is the one answer this command must never give wrongly. `-C` on a
missing directory is an error. All of it is held by tests, exercised rather than
asserted against the script text.

## Language

**Selection**:
What a consumer's manifest records — package _names_ and bundle _names_, never
paths. `bank:sync` resolves it to paths at the pinned ref on every run, so a
package that is renamed, moved or gains a dependency upstream changes what
arrives with nobody editing a list. The single most important thing about the
mechanism, and the reason `include` is not a manifest field.
_Avoid_: "the path list", "the include list"

**Closure**:
The transitive workspace set a selection resolves to: every selected package,
plus every workspace package reachable through its dependency edges, plus the
paths of the active bundles. Only workspace edges are followed — an ordinary npm
dependency stops the walk, because only workspace packages are paths in the
bank. "What did my two choices actually drag in" is a closure question, and the
wizard's preview answers it per package with the choice that required it.
_Avoid_: "the dependency tree", "the graph"

**Bundle**:
A named group of content that cannot be a package, because the tool that reads
it demands a fixed repo-relative path — `.github/workflows`, `deploy/`, the root
workspace files. Declared in `bank.paths.json`. A bundle marked
`alwaysIncluded` is not a choice: every selection receives it. Bundle paths are
literal prefixes, which makes them the one un-derived surface in the mechanism,
and therefore the only way a selection can go stale while still looking valid.
_Avoid_: "the extras", "the non-package stuff"

**Manifest** (`bank.manifest.json`):
The consumer's pin, in their repo: `upstream`, `ref`, the selection
(`packages`, `bundles`), `omit` and `contributable`. Written by the wizard, read
by both commands, and never edited by a sync. A manifest that still authors
`include` predates the selection contract and is rejected by name rather than
silently resolving to nothing.
_Avoid_: "the config", "the bank file"

**Vendor branch** (`vendor/bank`):
An orphan branch in the consumer's repo holding the bank's filtered tree and
nothing else. Each sync commits the newly resolved tree onto it; the consumer
merges it into their own history, so git does the three-way merge against a real
common ancestor. It is also the record of _which_ bank commit is held — the
commit message carries `commit: <sha>`, and `bank:contribute` reads it back out
to base its patch on that exact commit. That agreement between the two halves is
why `src/lib/bank.mjs` exists rather than each command carrying its own copy.
_Avoid_: "the mirror branch", "the upstream branch"

**Drift**:
What `bank:sync --check` reports: the difference between the bank at the pinned
ref and what the consumer currently holds. It writes nothing — it fetches into
the object store and reports — and it resolves the selection _non-strictly_, so
it can say "a bump would break this" rather than refusing to look. Its three
distinct exit codes are the contract, which is why they are exercised as
subprocesses.
_Avoid_: "the diff", "out of date"

**Contributable**:
The manifest's allowlist of paths permitted to flow back upstream. Empty by
default, and `bank:contribute` refuses every path while it is — the refusal
names the field and tells the human to add the path deliberately. Back-flow
takes code out of a repo that may be private and puts it in one that is public,
so the allowlist exists to force that judgement once, in a committed file,
rather than at the moment somebody is in a hurry. Layer is not the test:
a path being shared code does not make it publishable.
_Avoid_: "the whitelist", "the allowed layers"
