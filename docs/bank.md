# The bank: consuming Trellis packages

Trellis is a **bank** other repos take packages from and keep taking from, so a
fix made once reaches every repo that took it. This guide is for the maintainer
of one of those repos. It covers setting one up from nothing, keeping it
current, and resolving the conflicts a merge raises.

The mechanism is a vendored git subset updated by three-way merge
([ADR 0037](adr/0037-vendored-git-subset-three-way-merge.md)). Git is the only
distribution format that ships the **merge base** along with the content, which
is the whole reason for the choice. npm can only replace a package wholesale,
and copy-and-own gives you the files with no way to update them.

## What the bank holds

Packages, and the configuration around them. Only the second half is written
down.

**The package set is derived.** Everything the bank's `pnpm-workspace.yaml`
globs match is on offer — `tooling/*`, `packages/platform/*`,
`packages/shared/*` and the feature slices under `packages/features/*` — minus
anything on the exclusions below, which is what keeps `apps/*` off the menu.
Nothing enumerates them, so a package added, moved or renamed upstream needs no
edit anywhere, on either side
([ADR 0039](adr/0039-the-selection-is-the-contract.md)).

**Everything else is [`bank.paths.json`](../bank.paths.json)**, which carries the
two things no derivation gives you.

- **`bundles`.** Named groups of content that cannot be a package, because the
  tools that read it require it at a fixed repo-relative path. `root` is always
  included and holds the root `package.json`, `turbo.json`,
  `pnpm-workspace.yaml`, `patches/`, `scripts/` and the lint and hook configs.
  The rest are `scaffolding`, `agents`, `ci`, `docs` and `infra` — and `infra`
  selects itself when a package you took declares the services it needs.
- **`exclude`.** What is left out, with a reason each. `pnpm-lock.yaml`,
  `README.md`, `LICENSE` and `apps/` are all consumer identity. The bank
  distributes packages and configuration, never an application and never your
  front page.

A bundle path may be a single file rather than a directory — `agents` names
`.claude/settings.json` that way, while the generated symlinks beside it under
`.claude/skills/` stay out.

You name packages and bundles. `bank:sync` resolves that selection to paths at
the ref you pinned, following workspace dependencies to their transitive
closure — so taking `@acme/billing` takes `@acme/auth` and `@acme/subscriptions`
with it, and keeps taking whatever billing depends on next month without you
noticing. What arrives is **path-uniform**: any repo-relative path may end up in
it, and the bank makes no per-path promise about how well a given path merges.
Subscribing to a feature slice is allowed, and you own whatever conflicts it
produces.

Three paths arrive as **seeds** rather than as shared code: the root
`package.json`, `packages/platform/env` and `tooling/tailwind`'s `theme.css`.

`@acme/env` is a hard dependency of thirteen of the nineteen runtime packages, so
excluding it makes nearly every selection fail to install with nothing to copy
from — and the per-app part of env is the app's composition, which the bank never
distributes, not this package ([@acme/env ADR 0001](../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md)).
`theme.css` is the same shape one level down: `@acme/tailwind-config` is a hard
dependency of every UI package, and there is no way to express _take the package
but not one file_, because a resolved path is a prefix.

The root `package.json` is a seed for a narrower reason: only `name` in it is
yours, and the bank never edits that field, so it cannot conflict. The other six
are the tooling contract for `scripts/`, which arrives in the same bundle — the
script entries that invoke those files, and the devDependencies they run on. Take
`scripts/quality-gate.sh` without the manifest and you have a script with no
`turbo` installed and no `postinstall` to register the skills. See
[Bringing your own root manifest](#bringing-your-own-root-manifest) if your repo
already has one.

All three are yours to rewrite on arrival, and three-way merge is what makes that
safe: your edits survive every later sync and conflict only where both sides
touched the same lines.

## Setting up a consumer repo

### 1. Vendor the bank scripts

`scripts/` lives in the `root` bundle, so after your first sync the bank
commands arrive, and update themselves, like anything else. Setting up needs
them before they exist, so copy four files in by hand once:

```
scripts/setup-wizard.mjs
scripts/bank-sync.mjs
scripts/lib/bank.mjs
scripts/lib/bank-closure.mjs
```

`scripts/lib/bank.mjs` is the manifest reading and writing, ref resolving and
vendor-commit format the bank commands share; `scripts/lib/bank-closure.mjs`
turns a selection into paths. Neither the wizard nor the sync runs without both.
They need nothing installed — plain node and git are enough, which is why setup
works in a repo with no `node_modules`. `scripts/bank-contribute.mjs` arrives
with your first sync; you do not need it to pull.

### 2. Pin a bank tag

The bank's canonical branch is `main`, and known-good sync points are tagged
`bank/YYYY-MM-DD`. Pin a tag rather than a branch or a sha. A branch moves under
you, and a sha means choosing between hundreds of them.

```bash
git ls-remote --tags https://github.com/regybean/Trellis.git 'refs/tags/bank/*'
```

### 3. Author `bank.manifest.json`

`setup:wizard` writes it, from the selection you pass it:

```bash
node scripts/setup-wizard.mjs \
  --upstream https://github.com/regybean/Trellis.git \
  --ref bank/2026-08-26 \
  --packages @acme/logger,@acme/ui \
  --bundles docs
```

It fetches the bank at `--ref`, checks every name you gave exists there, and
writes the manifest — so a typo is a refusal that names it rather than a sync
that fails three steps later. It copies nothing; `bank:sync` below is still the
only thing that moves files. Both list flags repeat and accept `a,b`, so a
scripted setup can build them up either way, and `root` is dropped rather than
recorded, since it cannot be a choice.

A manifest already there is refused. `--force` replaces the **selection** and
keeps your `omit` and `contributable`, because a selection passed as arguments
says nothing about either.

Only this non-interactive form exists today. The picker over the bank's package
list is [#291](https://github.com/regybean/Trellis/issues/291).

What it writes, and what you would otherwise write by hand at the root of your
repo:

```json
{
  "upstream": "https://github.com/regybean/Trellis.git",
  "ref": "bank/2026-08-26",
  "packages": ["@acme/logger", "@acme/ui"],
  "bundles": ["docs"],
  "omit": [],
  "contributable": []
}
```

You author a **selection**, not paths. There is no `include`, and a manifest that
still has one is refused by name.

- **`upstream`.** The bank's git URL. It is public, so cloning or fetching it
  needs no credentials, including from a private host.
- **`ref`.** The bank tag you are pinned to. See [Pinning](#2-pin-a-bank-tag).
- **`packages`.** Workspace package **names**, `@acme/ui` rather than
  `packages/shared/ui`. Their transitive workspace closure comes with them, so
  list what you import and let the sync work out the rest. A name that does not
  exist at `ref` fails the sync rather than being dropped quietly.
- **`bundles`.** Bundle names from `bank.paths.json`. `root` is always included —
  don't list it, and you cannot opt out of it, because without it `pnpm install`
  does not work. `infra` selects itself when a package in your closure declares
  the services it needs.
- **`omit`.** Paths to subtract from your resolved closure, for the case where
  you keep your own. Default empty. See
  [Omitting part of your closure](#omitting-part-of-your-closure).
- **`contributable`.** The paths allowed to flow **back** to the bank. Default
  empty, so forgetting to maintain it fails closed. See
  [Contributing back to the bank](#contributing-back-to-the-bank).

### 4. Sync and merge

Run the first sync as plain node, since `pnpm bank:sync` is one of the entries
the sync itself delivers:

```bash
node scripts/bank-sync.mjs
git merge --allow-unrelated-histories vendor/trellis
```

The root `package.json` arrives in that merge, so from the second sync on it is
`pnpm bank:sync` like everything else.

The first merge needs `--allow-unrelated-histories` because your repo and the
vendor branch have no shared commit yet. Every merge after it is ordinary, and
the script prints the right command for you.

## Running a sync

Updating is two commands, and they stay two commands forever:

```bash
pnpm bank:sync                 # rewrites vendor/trellis; merges nothing
git merge vendor/trellis       # your call, your conflicts
```

`bank:sync` fetches the bank at `ref`, resolves your selection to paths **at that
ref**, and rewrites your local `vendor/trellis` branch so its tree is bank@ref
filtered down to them and nothing else, committed on top of the previous vendor
commit. Then it stops. It does not check anything out and does not touch your
working tree or index, so it is safe to run on a dirty branch.

Resolving at the ref rather than at authoring time is what keeps the selection
correct as the bank changes shape. A package that gains a dependency, moves
directory or is renamed arrives right on the next sync, with nothing to edit. The
vendor commit message records both what you selected and what it resolved to, so
`git log vendor/trellis` says why a path is in your tree.

Three rules keep the mechanism working.

- **`vendor/trellis` is pristine.** It holds upstream content only. Never commit
  to it. Edit it and you have destroyed the merge base, which is the only thing
  it exists to be.
- **Don't delete it.** It is state you cannot afford to lose. Recovery means
  re-syncing at the last ref you merged, then syncing forward again.
- **Merge is yours.** The sync never merges, so nothing lands in your history
  without you running `git merge`.

To take a newer bank, bump `ref` in the manifest and run the same two commands.

### Omitting part of your closure

Sometimes you take a package whose closure pulls in something you already have —
your own logger, your own auth. `omit` subtracts those paths after resolution:

```json
{ "omit": ["packages/platform/logger"] }
```

The sync warns for each entry, because the resulting tree does not install
unaided: something in it still imports `@acme/logger`, and you are now the one
supplying it. That is the whole point of the field, and the warning is there so
the substitution stays a decision rather than a surprise.

It is called `omit` and not `exclude` on purpose — `exclude` is the bank's word,
in `bank.paths.json`, for what it never distributes to anyone.

### Bringing your own root manifest

Setting up in an empty repo, the root `package.json` just arrives. Setting up in
a repo that already has one, you have two options.

**Keep yours, drop the bank's.** `omit` is the supported escape:

```json
{ "omit": ["package.json"] }
```

The sync warns by name, like any other omit, and you are then the one wiring
`scripts/` up — the script entries that invoke it and the devDependencies they
need. Copy them across from the bank's manifest.

**Merge the two.** Take the first sync and resolve the conflict once. Per field:

| Field             | Keep                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `name`            | **Yours.** The bank never edits it, so this conflicts only on the first merge.                            |
| `scripts`         | **Both.** The bank's entries drive `scripts/`; yours are yours. Rename on a genuine collision.            |
| `devDependencies` | **Both.** The bank's ten are what `scripts/` runs on. Dropping one breaks the entries that call it.       |
| `engines`         | **The bank's**, or higher. It is the floor the packages are built against.                                |
| `packageManager`  | **The bank's.** `pnpm-workspace.yaml` arrives in the same bundle and its catalogs assume that pnpm.       |
| `overrides`       | **Both**, unless they disagree on a version — then yours, and expect the conflict again on the next bump. |
| `private`         | Either. Both sides say `true`.                                                                            |

After that first resolution, later syncs conflict only where the bank edits a
line you also edited, like anything else.

### Script entries that assume an app you may not have

Most of the entries are workspace-wide (`turbo run build` with no `apps/` just
builds packages) or a call into `scripts/`. Seven name something specific, and
fail with "no projects matched" if you did not take it:

| Entry                 | Assumes                       |
| --------------------- | ----------------------------- |
| `build:nextjs`        | the `@acme/nextjs` app        |
| `build:nextjs-slim`   | the `@acme/nextjs-slim` app   |
| `build:tanstack-slim` | the `@acme/tanstack-slim` app |
| `test:nextjs`         | nothing — an alias of `test`  |
| `lint:mastra`         | the `@acme/chat` feature      |
| `seed:localstripe`    | the `@acme/billing` feature   |
| `studio`              | the `@acme/chat` feature      |

Delete the ones you have no use for. They are seven lines in a file the bank
treats as a seed, so deleting them conflicts only if the bank edits the same
lines. Nothing else in the manifest depends on them.

## Reading and resolving a conflict

Because the previous vendor commit is a genuine merge base, `git merge` replays
what changed upstream, keeps your local edits, and raises a conflict **only**
where both sides touched the same lines. Independent edits to different regions
of the same file merge silently.

A conflict looks like any other:

```
<<<<<<< HEAD
export const timeout = 30_000; // ours: raised for the slow ingest path
=======
export const timeout = 10_000; // theirs: bank@a1b2c3d4
>>>>>>> vendor/trellis
```

`HEAD` is your repo. `vendor/trellis` is the bank. Resolve it as you would any
merge:

```bash
git status                     # what is unmerged
git diff --diff-filter=U       # the conflicted hunks
$EDITOR <file>                 # resolve
git add <file>
git commit                     # completes the merge
```

Two things to check while you resolve:

- **Why the bank changed the line.** `git log -p <bank-sha-range> -- <path>` in a
  bank clone gives the reasoning, and the ADRs under `docs/adr/` cover the
  decisions that are hard to reverse.
- **Whether you resolve it the same way every sync.** If you do, either your
  version is generic and belongs back in the bank (see
  [Drift](#what-to-do-when---check-reports-drift)), or the path is yours and
  should come out of your selection — either drop the package or `omit` the
  path.

`git merge --abort` backs out without touching the vendor branch, so you can
retry whenever.

## Checking for drift

The bank cannot see its consumers and never will, so both drift questions run on
your side:

```bash
pnpm bank:sync --check
```

It writes nothing. No commits, no move of `vendor/trellis`, no change to your
working tree. It fetches objects and reads refs, and that is all.

```
bank:     https://github.com/regybean/Trellis.git
pinned:   bank/2026-08-26 (a1b2c3d4)
bank tip: main (e5f6a7b8)

Behind by 14 bank commits. Subscribed paths that changed in them:
  scripts (3 files)
  tooling/eslint (1 file)
  packages/shared/ui (9 files)

To take them: point "ref" in bank.manifest.json at the newest bank tag, then run pnpm bank:sync.

Bumping to the bank tip also changes what your selection covers:
  + packages/shared/icons
  - packages/platform/queue

Locally modified vendored paths:
  M  packages/shared/hooks/src/base-url.ts
  A  scripts/deploy-ado.sh

Review these and consider contributing them back to the bank — anything generic
here is a fix every other consumer is currently missing.
```

`--check` rolls upstream changes up to the subscribed path that owns them,
because a package-level answer stays readable where nine months of file names
does not. It lists your own modifications per file with their git status,
because those are what you review one by one.

The `+`/`-` block is your **closure delta**: `--check` resolves your selection at
both the pinned ref and the tip, so "bumping also brings `@acme/icons`, which
`@acme/ui` now depends on" is something you read before the bump rather than
discover when the install fails. It has no exit code of its own, because a
closure only moves when `ref` does — it is never news independent of being
behind.

It measures those modifications against the merge base of `HEAD` and
`vendor/trellis`, the last vendor commit you actually merged. So a sync you have
not merged yet does not show up as your drift.

When everything is current:

```
Up to date with bank/2026-08-26 (a1b2c3d4) — nothing unpulled, no locally modified vendored paths.
```

### Exit codes

| Code | Outcome        | Meaning                                                                                  |
| ---- | -------------- | ---------------------------------------------------------------------------------------- |
| `0`  | **up to date** | Nothing unpulled. Locally modified paths may still be reported. Those are yours to keep. |
| `1`  | **error**      | Bad manifest, unreachable bank, or a `ref` that does not resolve.                        |
| `2`  | **behind**     | The bank has commits you have not taken, or `vendor/trellis` is not at the pinned `ref`. |

Three outcomes, three codes, so any CI can gate on them.

## What to do when `--check` reports drift

**Behind by N commits.** Read the paths it listed, bump `ref` to the
newest `bank/YYYY-MM-DD` tag, run `pnpm bank:sync`, and merge. Nine months of
drift arriving in one merge is the failure this command exists to prevent. Pull
on a rhythm, not on discovery.

**Locally modified vendored paths.** Read each one and decide which it is.

- **Generic.** A fix or improvement with nothing to do with your domain. See
  [Contributing back to the bank](#contributing-back-to-the-bank).
- **Yours.** Domain-specific, or a deliberate divergence. Leave it. It survives
  every sync, and it conflicts only if the bank edits the same lines.
- **Accidental.** A local hack nobody remembers. Revert it and take the bank's
  version back.

**`vendor/trellis` does not hold the pinned ref.** You changed your selection or
`ref` without syncing — or the bank moved a path your selection covers. Run
`pnpm bank:sync`.

## Contributing back to the bank

Pulling from a public bank is always safe. Contributing the other way is the
constrained direction: it takes code out of a repo that may be private and puts
it in one that anyone can read, permanently, whatever you delete afterwards. So
back-flow is a separate command with its own gates.

```bash
pnpm bank:contribute packages/platform/logger
```

It diffs that path against the bank content you last merged, refuses anything
outside `contributable`, scans the diff with `gitleaks`, prints the whole diff,
and opens a PR on the bank **only** after you type the word `contribute`. In
order:

1. **The allowlist.** Every path must sit under an entry in `contributable`.
   This runs first, before anything is fetched or cloned, so a refusal reaches
   the network with nothing.
2. **The base.** The patch is diffed against the merge base of `HEAD` and
   `vendor/trellis`, the last vendor commit you actually merged. That commit
   records the bank sha it was built from, and the PR branch is cut from exactly
   that commit. So the patch applies to the bank by construction, and the PR
   shows your change and nothing else.
3. **Committed history only.** Uncommitted changes under the path are an error,
   not a silent inclusion. What you review is exactly what the PR carries.
4. **`gitleaks`.** The diff is scanned, and any finding aborts and opens nothing.
   A missing `gitleaks` is also a refusal. Everywhere else in this repo an
   absent scanner degrades to a warning, but this is the last automated check
   before code leaves a private repo for a public one.
5. **The confirmation.** The full diff is printed and you type `contribute`.
   Anything else aborts. There is no flag to skip this.

If you have no write access to the bank, the push fails and the command tells you
where the prepared commit is waiting so you can push it to a fork and open the PR
from there. Nothing has been published at that point.

### What the machine cannot check for you

**Layer is not the test.** A `shared/` package can still be tied to your domain,
and a `features/` slice can be entirely generic. Nothing about where a file sits
in the layer graph says whether it is safe to publish. That judgement is why
`contributable` is a list a human maintains rather than a rule derived from the
manifest.

**A human reads every diff, every time.** Nothing invokes `bank:contribute` from
CI, a git hook, or a schedule, and nothing should. There is no `--yes`. If you
find yourself wanting one, the thing you actually want is a smaller diff.

**`gitleaks` catches secrets, not client context.** It will not flag a comment
referencing an internal ticket number, a client's domain terms in a type name, an
internal hostname, or a colleague's name in a `TODO`. None of those are
credentials and none of them are yours to publish. Read the diff for them.

Before contributing anything that came out of client work, confirm with the
engagement owner that publishing generic infrastructure code to a public repo is
permitted at all. A person answers that once, per engagement. It is not a
per-path question and it is not one this command can ask.

### The day-one `contributable` seed

**Empty.** Every consumer starts with `"contributable": []`, and that is the
recommended day-one value rather than an oversight.

[#219](https://github.com/regybean/Trellis/issues/219) named one candidate to
seed the list with, `hooks/base-url.ts`. That file does not exist. The logic it
referred to is now `getBaseUrl` inside
[`packages/shared/hooks/src/create-feature-client.tsx`](../packages/shared/hooks/src/create-feature-client.tsx),
a private function at the bottom of a 300-line factory. It cannot be contributed
on its own. Allowlisting it means allowlisting a path that carries the whole
feature-client factory, which is a much larger decision than the original
candidate implied.

Nothing else has been through the review the section above describes, and no
consumer has yet completed a sync, so there is no diff anyone has read and
approved. Seeding a list on a guess would defeat the point of having one. Add
your first entry when you have a specific local change in front of you and have
decided it is generic.

## Why no CI workflow ships with the bank

`--check` is a command rather than a GitHub Actions workflow, and that is
deliberate. [#219](https://github.com/regybean/Trellis/issues/219) originally
asked for two CI jobs, but the known consumer runs on Azure DevOps, where GitHub
workflow YAML is dead weight. Shipping a workflow that one consumer must delete
and another must translate is worse than shipping neither.

So the bank ships behaviour with documented exit codes and each consumer wires
its own CI. Nothing was forgotten. Don't add a workflow here on the assumption
that it was. A scheduled job that runs `pnpm bank:sync --check` and fails on a
non-zero exit is a handful of lines in whatever CI you already have.

## Maintainer side: cutting a bank tag

For maintainers of Trellis itself.

- **`main` is canonical.** There is no release branch and no separate bank repo.
- **Tag by hand when something worth pulling lands.** Cut `bank/YYYY-MM-DD` at
  that commit. It is a judgement call, not a schedule. The tag says the bank was
  worth syncing from at that commit, which a nightly tag would not.

```bash
git tag bank/$(date +%F) main
git push origin bank/$(date +%F)
```

Adding a package needs no edit to `bank.paths.json` — the package set is derived.
Adding a root-level file does, and `pnpm lint` fails naming it until it is either
in a bundle or on `exclude` (`scripts/check-bank-paths.mjs`). There is no third
answer: an unclassified root entry is content nobody can take and nobody can see
was withheld.

Consumers pin those tags, so a tag promises that `main` was green at that commit.
Cut it after the gate passes, not before.

Nothing else on `main` changes for the bank. Trellis stores nothing about who
consumes it. No consumer list, no per-consumer export, no automation beyond the
tag.

## Related

- [ADR 0037](adr/0037-vendored-git-subset-three-way-merge.md) covers the
  distribution model, and what was considered and rejected.
- [ADR 0038](adr/0038-acme-scope-is-a-distribution-constraint.md) covers why
  renaming the `@acme` scope breaks the mechanism.
- [ADR 0039](adr/0039-the-selection-is-the-contract.md) covers why neither side
  enumerates paths.
- [`bank.paths.json`](../bank.paths.json) is the bundles and the exclusions; the
  package set is the `pnpm-workspace.yaml` globs.
- [`scripts/setup-wizard.mjs`](../scripts/setup-wizard.mjs) authors the manifest;
  [`scripts/bank-sync.mjs`](../scripts/bank-sync.mjs) pulls;
  [`scripts/bank-contribute.mjs`](../scripts/bank-contribute.mjs) is the guarded
  path back. All three run over
  [`scripts/lib/bank.mjs`](../scripts/lib/bank.mjs), and the wizard and the sync
  over [`scripts/lib/bank-closure.mjs`](../scripts/lib/bank-closure.mjs) for the
  selection.
