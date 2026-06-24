# `pnpm dev` derives the infra it starts from the dependency graph, not a per-app list

`pnpm dev [app ...]` brings up only the infra services its target apps actually
need, waits for them to be healthy, pushes schemas, then starts the dev servers.
The non-obvious part is **where the list of needed services comes from** and a few
deliberate choices around it.

## Infra is derived from the graph, declared per package

Each package that touches an infra service declares it in its `package.json` under
`acme.infra` (e.g. `@acme/redis` → `["redis"]`, `@acme/ingest` → `["localstack"]`,
`@acme/rag`/`@acme/chat` → `["postgres", "ollama"]`, `@acme/billing` →
`["postgres", "billing"]`, `@acme/telemetry` → `["jaeger"]`). An app's required
infra is the **union of `acme.infra` over its transitive workspace closure**
(`scripts/resolve-infra.mjs`, via `pnpm --filter "<app>..." ls`). Each entry is a
Compose **profile** of the same name in `compose.yaml`.

This follows the slice contract ([ADR 0010](0010-slim-no-auth-apps.md)): infra need
travels with the package that owns it, down the dependency edges, exactly like code.
A slim app that doesn't depend on `@acme/billing` derives no `billing` service —
**because the dependency graph already encodes that**, not because anyone maintained
a parallel list. Adding an app needs zero change here; adding infra to a feature is
one line in that feature's `package.json`.

**There is no `core` / always-on set.** Nothing is assumed running. An app whose
closure declares no infra starts none — which is the point: it keeps any future
reduced-runtime app (a core-only case) honest, and makes the resolver's
output an audit of what an app truly couples to.

## The graph gives candidates; env prunes them

Two services are only needed under a configuration, so the graph yields a candidate
set that env then prunes:

- `billing` (localstripe) is dropped unless `STRIPE_API_BASE` is set — real Stripe
  needs no local container ([ADR 0004](0004-localstripe-dev-billing.md)).
- `ollama` is dropped unless `LLM_PROVIDER` or `EMBED_PROVIDER` is `ollama` — the
  provider is a runtime choice; the graph only records "this package does LLM/
  embeddings" ([ADR 0003](0003-multi-provider-models.md)).

Both are _prunes of graph-derived candidates_, not special cases bolted on — the
model stays uniform: **graph = candidate set, env = prune.** `infra:up` reuses the
same resolver with no app args (the union over every app) so the standalone-infra
command and dev can't drift.

## Dev push is non-interactive and accepts data loss

`pnpm dev` runs each app's `db:push` with `--force` against a push-only Drizzle
config that sets `strict: false` (`drizzle.push.config.ts`). Both gates must drop
for push to be fully non-interactive: `--force` skips the data-loss confirm,
`strict: false` skips the always-confirm. This is safe **only because push is a
dev/local affordance** — production schema changes go through `db:generate` +
migrate, never push. The push step only runs when `postgres` is in the resolved set
and is gated `--if-present`, so a DB-less app skips it cleanly.

## Infra is never auto-torn-down

`dev` leaves infra running on exit; stopping is the explicit `pnpm infra:down`.
`up --wait` is idempotent, so re-running `dev` returns immediately when everything
is healthy, and a subset bring-up leaves unrelated running services untouched —
covering the common case of wanting infra up without the app, and of switching
between apps without churning containers.

## Status

accepted

## Considered and rejected

- **A per-app infra list** (e.g. `acme.infra` on each _app_, or a script-side map of
  app → services). Rejected — it duplicates what the dependency graph already
  encodes and drifts the moment an app's deps change or a new app is added. Deriving
  from the closure is the no-maintenance option and makes the slim/full difference
  fall out for free.
- **A `core` always-on profile** (postgres/redis/localstack/jaeger always up).
  Rejected — convenient today (every current app happens to need all four) but it
  bakes in an assumption that breaks the reduced-runtime app the portability claim
  depends on, and hides real coupling. Per-service profiles cost nothing extra and
  keep "needs nothing" expressible.
- **Making `ollama` env-only** (not graph-derived). Rejected — it would be the one
  special-cased service. Declaring it on the model-using packages and pruning by
  provider keeps every service in one uniform model.
- **Running the app itself in Compose.** Rejected for now — apps run on the host;
  only infra is containerised. Not worth the indirection at this stage.
