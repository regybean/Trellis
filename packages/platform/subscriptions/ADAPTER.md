# Mounting `@acme/subscriptions`

A real implementation of the entitlements seam, backed by a credit ledger in
Redis and a plan mapping you supply. Mount this when you want metered features
to actually meter.

## What it gives you

- `createSubscriptionsEntitlements` — an `EntitlementsProvider` built from your
  plan ids, ready to inject into your route seam and your worker.
- A credit ledger keyed per principal, with consume and refund, so a failed job
  gives the credit back rather than silently keeping it.
- Per-tier credit limits as configuration, so changing an allowance is a value
  change and not a code change.
- Customer-to-plan lookups, for app code that needs to show a plan without
  going through a feature.

## Surface

| Import                    | What's in it                           | Runs   |
| ------------------------- | -------------------------------------- | ------ |
| `@acme/subscriptions`     | The provider factory, credits, lookups | server |
| `@acme/subscriptions/env` | This package's env factory             | either |

## Wiring

- Build the provider **once**, in your app's composition root
  (`src/server/deps.ts`), and import it from there into your route seam
  ([trpc-route.md](../../../docs/mounting/trpc-route.md)) and your worker
  entrypoint ([worker.md](../../../docs/mounting/worker.md)). Two providers, or a
  no-op in the worker, means refunds land somewhere nothing reads — and both
  typecheck, so one file is the only thing that rules it out
  ([ADR 0006](../../../docs/adr/0006-entitlements-injection-seam.md)).
- Supply the plan ids. They are per-deployment data, so this package takes them
  as an argument rather than reading them; a billing package's env is the usual
  source.
- Compose the env factory and provide Redis —
  [env.md](../../../docs/mounting/env.md),
  [infra.md](../../../docs/mounting/infra.md).

## Env

Both keys are profile-authored config: the per-tier credit limits and the
fallback limit for an unrecognised tier. Each is overridable by an environment
variable of the same name, so retuning an allowance on a live deploy needs no
rebuild. See `src/env.ts`.

## Infra

`redis`. The credit ledger lives there; nothing prunes it.
