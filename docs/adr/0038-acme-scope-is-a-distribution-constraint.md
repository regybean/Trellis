# The `@acme` scope is a distribution constraint, not placeholder naming

`@acme/*` reads like naming left over from a starter kit, the kind of thing
someone renames on a slow afternoon so the repo feels like it belongs to the team
that owns it. Under [ADR 0037](0037-vendored-git-subset-three-way-merge.md) that
rename is one of the most expensive edits available.

Vendored packages update by three-way merge. A scope rename in a consumer
rewrites the import line of every file that imports a bank package, thousands of
lines whose content nobody meaningfully changed. Every later sync then conflicts
on those lines, because upstream keeps editing files whose imports the consumer
rewrote wholesale. The merge stops being worth running and the consumer is back
to copy-and-own with extra ceremony.

The divergence measured in
[#219](https://github.com/regybean/Trellis/issues/219) was readable only because
both repos happened to keep `@acme`. What it found was real semantic drift. Under
a renamed scope the same measurement would have drowned in import churn.

## Decision

The `@acme` scope is fixed, repository-wide, no exceptions.

- **Bank packages keep it.** `@acme/ui`, `@acme/trpc` and `@acme/logger` are
  their names in the bank and in every consumer.
- **A consumer's own packages use it too**, including slices the bank has never
  seen. A consumer's local feature is `@acme/risk-map`, not `@client/risk-map`.
- **A rename is a change to the distribution model**, not a cleanup. It needs an
  ADR superseding this one, and the honest cost line in that ADR is "every future
  merge from the bank conflicts on imports".

That third bullet is why this is written down. The first two are enforced by
nothing except a reader knowing what they are for.

### Why a consumer's own slices are included

Two scopes look tidier, one for theirs and one for ours, and cost more than they
save.

- **Promotion becomes a rename.** A package moves into the bank on second demand.
  If local packages carry a different scope, every promotion rewrites the
  package's own name and every import of it, on both sides. That is the churn
  this ADR exists to avoid.
- **The vendored config is keyed on `@acme/*`.** ESLint boundary tags, tsconfig
  paths, turbo filters and syncpack rules all live in vendored files. A second
  scope means editing those files, so the tidiness is paid for with permanent
  conflicts in exactly the files that most need to merge cleanly.
- **The scope was never the answer to "where did this come from".** Layer
  (`platform` / `shared` / `features`) and the manifest's `include` already say
  that, and they stay accurate when a package changes sides.

## Considered and rejected

- **Rename per consumer to a client scope.** The natural instinct on
  client-branded work, and the one that kills the mechanism. The client's
  identity belongs in the app, the deploy and the README, not in the import
  specifier of a shared package.
- **Rename in the bank instead, to something less placeholder-ish.** Same cost,
  paid once by every consumer at the same time.
- **Keep `@acme` for vendored packages and use a local scope for local ones.**
  The mixed model above: promotion churn plus edits to vendored config.
- **Enforce the scope with a lint rule.** A rule is cheap and may well follow. It
  would catch a new package with the wrong scope. It would not stop the
  repo-wide rename this ADR is written to prevent, because whoever runs that
  rename updates the rule in the same pass. The prevention that works is knowing
  why.

## Status

accepted

## Consequences

- **`@acme` cannot double as a signal of anything else.** It names no org, client
  or product. That is a cost, and we accept it.
- **Publishing to npm would need a real scope.** Out of scope by
  [#219](https://github.com/regybean/Trellis/issues/219), and if it ever happens,
  the published name and the workspace name are separable through a publish-time
  alias rather than a repo-wide rename.
- **A new consumer inherits the constraint on day one**, before it has anything
  to merge, which is the moment renaming still looks free and is most tempting.
