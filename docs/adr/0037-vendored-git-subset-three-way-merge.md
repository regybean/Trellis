# Vendored git subset with three-way merge is the distribution model

Trellis is a bank of packages that other repos start from. Until now they started
from it by copying the repo once. The measured result of that
([#219](https://github.com/regybean/Trellis/issues/219)): one consumer, nine
months of independent work, ~8,500 lines of shared packages, of which about 77%
would still merge without conflict. No mechanism existed to merge them, so every
fix made on either side stayed there.

The problem is not how to ship the code. Copying ships the code. The problem is
shipping the **merge base** along with it, because without one an update means
diffing two trees by hand, and nobody does that twice.

## Decision

Consumers take a **vendored git subset** and update it by **three-way merge**.

A consumer repo holds `bank.manifest.json`:

```json
{
  "upstream": "https://github.com/regybean/Trellis.git",
  "ref": "bank/2026-08-26",
  "include": ["tooling", "scripts", "turbo.json", "packages/platform/logger"],
  "contributable": []
}
```

`pnpm bank:sync` (`scripts/bank-sync.mjs`) reads it, fetches the bank at `ref`,
and rewrites the consumer's local `vendor/trellis` branch so its tree is bank@ref
filtered down to `include` and nothing else, committed on top of the previous
vendor commit. Then it stops and prints the merge command for the human to run.

```
Trellis (bank)                consumer

main ──● A ──● B ──● C        main ──●──●──●───────●──────────●──▶
        │           │                            ╱          ╱
        └───────────┼──────── vendor/trellis ──●@A ───────●@C
                    └──────── (filtered, pristine)   base for the merge
```

Four properties make it work, and each is a rule rather than an accident.

**The vendor branch is pristine.** It holds upstream content only. No consumer
commit ever lands on it. Edit it and you have destroyed the merge base, which is
the only thing it exists to be.

**Each sync parents on the last one.** That makes the previously merged vendor
commit a genuine merge base, so `git merge` replays what changed upstream, keeps
local edits, and raises conflicts only where both sides touched the same lines.
The first merge needs `--allow-unrelated-histories`. Every one after it is
ordinary.

**The sync never merges.** It writes one ref and prints a command. It does not
check out, and it does not touch the working tree or the index, because the
filtering runs through plumbing against a throwaway index file. So it is safe to
run on a dirty branch. Merging is the human's call, and conflicts are the
consumer's to resolve.

**It fails before it writes.** A `ref` that does not resolve upstream, a
malformed manifest, or an `include` that matches nothing all abort before the
`update-ref`, so `vendor/trellis` only ever moves on a sync that fully succeeded.

`include` is path-uniform. Any repo-relative path may appear in it, and the bank
makes no per-path promise about how well a given path merges. Subscribing to a
feature slice is allowed, and the consumer owns whatever conflicts that produces.

**What is on offer lives in [`bank.paths.json`](../../bank.paths.json)** — the
selectable workspace packages, the six named bundles for content that cannot be
a package (`root`, `scaffolding`, `agents`, `ci`, `docs`, `infra`), and the
paths excluded by default with a reason each. `bank:sync` does not read it; it
is the input a consumer's `include` is assembled from, and the record that stops
the definition drifting from the repo the way an inventory in prose already did
(#254).

## Why git

Git is the only distribution format that ships the merge base with the content.
Everything else ships a snapshot and leaves the reconciling to a human holding
two trees and a diff tool.

## Considered and rejected

- **Published npm packages.** Ruled out by the evidence, not by taste. The
  consumer needed to _delete_ `@acme/entitlements` from `@acme/trpc`. A version
  range is replace-or-nothing, so a consumer that must remove code from a package
  cannot express that as a dependency. Semver also assumes the publisher can
  define compatibility for consumers it cannot see.
- **Copy-and-own (the shadcn model).** This is the status quo we are leaving.
  shadcn's own docs say the code is yours to maintain once installed, and its
  `diff` command has been experimental since 2023. The update story is exactly
  the part that never got built.
- **`git subtree`.** It needs a whole-directory prefix. The consumer's
  `packages/platform/` and `packages/features/` interleave vendored packages with
  local ones, so the unit of subscription is an arbitrary set of paths, which
  subtree cannot express.
- **`git merge-file` against a temp checkout.** No merge base for free, no rename
  detection, and no record that a sync ever happened. It is the manual process
  with extra steps.
- **A bank-side filtered export per consumer** (`git filter-repo`, subtree split).
  Produces the same trees while putting per-consumer state and tooling on the
  bank. Trellis stores nothing about who consumes it, and the filtered-tree commit
  gets the same ancestry from plumbing every git install already has.

## Status

accepted

Implements the distribution decision in
[#219](https://github.com/regybean/Trellis/issues/219), superseding "copy the
repo once".

## Consequences

- **`vendor/trellis` is state the consumer cannot afford to lose.** Delete it and
  the merge base goes with it. Recovery is re-syncing at the last ref that was
  merged, then syncing forward again.
- **Rename detection works**, because the vendor branch is a real tree with real
  history rather than a pile of files.
- **The bank cannot see its consumers.** Drift detection, "how far behind are we",
  and any policy about locally modified vendored paths are consumer-side jobs.
- **Sync is one-directional.** Back-flow is a separate mechanism gated by
  `contributable` (default empty, so forgetting to maintain it fails closed), and
  it never runs automatically. It is `scripts/bank-contribute.mjs`: allowlist,
  then gitleaks over the diff, then a typed confirmation, then a PR. Layer is not
  the test for what may be published, so the allowlist stays a human's list
  rather than anything derived from the manifest.
- **The fetch is not shallow.** A `--depth` fetch would leave a shallow graft in
  the consumer's repo to buy a one-off speedup. The sync fetches normally instead.
- **`@acme` becomes a hard constraint**, since a scope rename would put every
  import line into conflict. That is its own decision,
  [ADR 0038](0038-acme-scope-is-a-distribution-constraint.md).
