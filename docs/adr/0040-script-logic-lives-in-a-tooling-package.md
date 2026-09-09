# Script logic lives in a tooling package; root `scripts/` holds entry points only

**Status:** accepted

Root `scripts/` grew to 4,800 lines of program — three repo checkers, the bank,
the test inventory, the secrets sync, the infra resolvers — and it was the one
directory in the repo where none of the repo's own rules applied. Not because
nobody enforced them. Because there was nothing for them to attach to.

`scripts/` is not a workspace package. It therefore has no `package.json`, so no
`acme.testClass`; no `src/tests/`, so no test layout to enforce; no `tsconfig`,
so `pnpm typecheck` never read it; no `turbo.json`, so no cache entry and no
boundary tag. [ADR 0007](0007-package-test-policy.md)'s co-location rule reaches
every package in the workspace and could not reach this directory at all, and
`check-exports` skipped it for the same reason.

The consequence was not a style lapse, it was forced. Tests for these programs
had to be filed wherever a backend vitest config and testcontainers were already
wired, and that was `@acme/test-utils` — so 121 tests, 18% of the repo's 672,
sat in a package whose name described none of them, while its own seven source
files had no tests. `containers.ts`, load-bearing for every backend suite in the
repo, had no coverage, and the borrowed 121 hid that. The cache followed the
same fault line: `pnpm turbo run test -F @acme/test-utils` ran the bank's slow
git sandboxes and the ADR checker as one unit, so editing one invalidated the
other.

Testability went the same way. Only one file under `scripts/` exported anything;
the rest ran their logic as an import side effect, so `check-adrs` shelled out
to git at module load and `resolve-compose-env` wrote to stdout before any
importer could intervene. Subprocess tests were not a preference, they were the
only option. `check-exports` derived its root with no argv override, and
consequently had zero tests while the other two checkers had 22 between them —
one line of code explaining the whole coverage gap.

A directory that is not a package has no seams to enforce, so it accumulates
whatever nobody wanted to give a home. That is the property to remove, not the
contents.

## Decision

**Script logic lives in a `tooling/*` workspace package. Root `scripts/` holds
entry points only.**

Root `scripts/` keeps exactly four kinds of thing. The categories are the rule;
the files named under each are what happened to be there when this was written,
not a closed list.

1. **Shell entry points** — what a human types, or what a git hook invokes on
   their behalf: `dev.sh`, `test.sh`, `infra.sh`, `infra-up.sh`, `compose.sh`,
   `preview.sh`, `quality-gate.sh`, `graph.sh`, `bootstrap-worktree.sh`,
   `register-skills.sh`, `extract-app.sh`, `check-remote-cache.sh`,
   `env-pull.sh`, `env-push.sh`, and `format-staged.sh` from the lefthook
   pre-commit hook. Plus the secrets preamble and `secrets-backends/` adapters
   the two `env-*` scripts dispatch through
   ([ADR 0001](0001-pluggable-secrets-sync.md) — the adapter seam is shell
   because a consumer extending it writes shell).
2. **The install-time helpers** — `sync-claudeignore.mjs`,
   `link-worktree-env.mjs` and `link-agent-docs.sh`, which run on `postinstall`,
   before any package is guaranteed built.
3. **The log helper** — `lib/dev-logs.sh`
   ([ADR 0028](0028-dev-and-compose-logs-mirrored-to-files-for-the-agent.md)).
4. **The two boundary shims**, below.

The test for a new file is which of those four it is. If it is none of them, it
is a package — and "a human types it" is not the deciding question, since a
lefthook hook and a `postinstall` step are both entry points nobody types.

Anything else is a package: `src/`, `src/tests/backend/`, a `package.json`
declaring its `acme.testClass`, a `turbo.json` tagged `tooling`, and its own
script that the root delegates to with `pnpm --filter`. The command a human
types does not change — `pnpm check:adrs` still works, and now works from
inside the package too.

The layer is `tooling` and no sixth layer is added: these programs depend on
nothing in the product graph, which is already exactly what the `tooling` tag
permits. They sit flat under `tooling/`, with no `tooling/cli/*` sub-glob,
because a second workspace glob would have to be mirrored into every checker
that reads the workspace directory list.

`tooling/*` packages remain outside the exports convention
([ADR 0015](0015-package-exports-convention.md)), so a script package owes no
`exports` ceremony beyond what it actually exposes.

### The two resolvers split, then stopped needing the split

`scripts/resolve-infra.ts` and `scripts/resolve-compose-env.ts` used to import
`packages/platform/db/src/development-profile` and its siblings by relative
path, deliberately bypassing the `exports` maps so they need no build. That is
legal only while the file carries no boundary tag: inside a `tooling` package it
would be a `tooling` → `platform` edge, which the tag rules forbid, and it would
trip turbo's package-escape rule as well.

So these two split rather than moved — the decisions into
`@acme/workspace-graph` as functions over provider values, the profile imports
left behind in `scripts/` to pass those values in. Which made the rules
testable, and left both files naming five packages that a checkout is free not
to have.

The boundary rule was never the reason a value had to be _named_. Provisioning
is now discovered: each package declares its own contribution, and the graph
loads what the closure holds ([ADR 0009](0009-graph-derived-dev-infra.md)).
Both files shrank to a call over app names, importing nothing from `packages/`
— so the shim half of this decision is spent, while its point stands: the logic
lives in a package that can be tested, and nothing under `scripts/` decides
anything.

### The bank is exempt from the language, not the placement

`tooling/bank` is a package like the rest, but stays plain `.mjs` on `node:`
builtins only, and keeps its own copy of the workspace-graph helpers. It has to
run hand-copied into a repo with no `node_modules`, so it cannot import the
kernel. Deleting the package takes both the duplication and its reason, so that
decision is [the bank's own ADR 0001](../../tooling/bank/docs/adr/0001-the-bank-keeps-its-own-workspace-helpers.md)
rather than this one.

## Considered and rejected

- **Make `scripts/` itself a workspace package.** The cheapest-looking fix, and
  it fails on the shims: one package holding both the checkers and a file that
  imports `packages/platform/db` by relative path either forfeits the boundary
  tag — restoring the exact hole this ADR closes — or cannot hold the shims. It
  also keeps the cache granularity problem, since one package is one cache
  entry, which is half the daily cost.
- **A sixth layer for programs.** Buys a new turbo tag, a new `boundaries`
  entry and new class mappings, in exchange for no constraint that `tooling`
  does not already impose.
- **A sixth package for infra resolution.** More structure than two shims and a
  handful of pure functions need.
- **Leave it and write a convention doc.** The arrangement was structural, so a
  convention would be the one rule in the repo with no mechanism behind it —
  which is how `scripts/` reached 4,800 lines in the first place.

## Consequences

- **A new script has one place to go, and the gate reaches it.** Its package is
  typechecked, linted, boundary-tagged, cached independently, and owes tests
  next to the code. Adding a program no longer means choosing where its tests
  will be allowed to live.
- **A rule is a function over a value.** `validate(name, exportsMap)` and its
  equivalents replaced logic welded into a top-level `for` loop, so asserting a
  string comparison no longer means materialising a package tree on disk. The
  thin subprocess layer stays per CLI, covering exit codes, one golden output
  shape and the refusal paths — that is a command-line program's actual
  contract.
- **`@acme/test-utils` is honest about what it is, and about what it lacks.**
  With the borrowed 121 tests gone it declares `acme.testStatus: "todo"` with a
  reason. Testing the thing that starts testcontainers is a separate decision.
- **The count reconciles, which is how we know nothing was dropped.** 672 tests
  before the move; 956 after. The 551 that never lived in `scripts/` are
  unchanged, and the 121 subprocess tests became 405 across the five packages
  (`repo-checks` 122, `bank` 92, `test-inventory` 80, `secrets-sync` 56,
  `workspace-graph` 55) as rule-by-rule assertions replaced tree-materialising
  ones. A package move silently un-collecting a suite is invisible while
  `passWithNoTests` stays on, so the total was captured before the first ticket
  and compared after each.
- **The moved paths are paths consumers have already vendored.** `scripts/` ships
  in the bank's `root` bundle, which is `alwaysIncluded`
  ([ADR 0039](0039-the-selection-is-the-contract.md)), so every package path had
  to join that bundle before anything moved. Anything root `package.json`
  invokes must arrive with the root bundle, because root `package.json` is itself
  root-bundle content. That constraint applies to every future script package
  too.
- **Root `scripts/` can be read in one screen**, and what is left there is
  self-describing: if it is not something a human types or something that runs
  before the packages are built, it is in the wrong directory.
