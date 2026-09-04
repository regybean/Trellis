# Mounting `@acme/entitlements`

A type and a no-op implementation. It is the seam that lets a feature ask "may
this principal do this, and what does it cost" without knowing whether your app
has billing at all
([ADR 0006](../../../docs/adr/0006-entitlements-injection-seam.md)).

## What it gives you

- `EntitlementsProvider` — the interface features program against. A feature
  that charges for work depends on this type, never on a billing package.
- `unlimitedEntitlements` — a provider that permits everything and charges
  nothing, so an app with no billing can mount a metered feature as-is.
- A tier comparison helper, for gating on plan level rather than on credits.

## Surface

| Import               | What's in it                        | Runs   |
| -------------------- | ----------------------------------- | ------ |
| `@acme/entitlements` | The provider type, the no-op, tiers | either |

## Wiring

- Choose a provider **once**, in your app's composition root
  (`src/server/deps.ts`). It is required with no default, so a deployment has to
  state whether it meters or not
  ([ADR 0006](../../../docs/adr/0006-entitlements-injection-seam.md)).
- Import it from there in your route seam
  ([trpc-route.md](../../../docs/mounting/trpc-route.md)) and your worker
  entrypoint ([worker.md](../../../docs/mounting/worker.md)). A worker holding a
  second provider refunds a ledger nothing is reading, and it typechecks just as
  well as the right one — one file is what rules it out.
- To meter for real, supply your own implementation of the interface, or mount a
  billing-backed one. Nothing else in your app changes: features already read
  the seam.
