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

- Inject a provider in your route seam. It is required with no default, so a
  deployment has to state whether it meters or not —
  [trpc-route.md](../../../docs/mounting/trpc-route.md).
- Inject the **same** provider in your worker entrypoint, or a failed job
  refunds a ledger nothing is reading —
  [worker.md](../../../docs/mounting/worker.md).
- To meter for real, supply your own implementation of the interface, or mount a
  billing-backed one. Nothing else in your app changes: features already read
  the seam.
