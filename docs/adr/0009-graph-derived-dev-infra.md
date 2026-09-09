# `pnpm dev` derives the infra it starts from the dependency graph, not a per-app list

**Status:** accepted

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
(`scripts/resolve-infra.ts`, via `pnpm --filter "<app>..." ls`). Each entry is a
Compose **profile** of the same name in `deploy/compose.yaml`.

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

## The graph gives candidates; the closure's own packages decide what to do with them

Some services are only needed under a configuration, and each candidate needs
values to start with. Both answers are **declared by the packages in the same
closure** and discovered from it, under two more manifest keys beside
`acme.infra`:

- `acme.provisioning` names a module exporting `PROVISIONING`, a record of
  profile name to what this package supplies for it: the `compose` values it
  authors, and `needed: false` when its own configuration does not want the
  service after all. So `@acme/billing` drops the `billing` (localstripe)
  profile unless the authored Stripe connection is localstripe — real Stripe
  needs no local container
  ([@acme/billing ADR 0001](../../packages/features/billing/docs/adr/0001-localstripe-dev-billing.md)) — and `@acme/models` drops `ollama`
  unless the chat or embed role runs on it, the graph having recorded only that
  a package does LLM/embeddings
  ([@acme/models ADR 0001](../../packages/shared/models/docs/adr/0001-multi-provider-models.md)).
- `acme.seeds` maps a profile to a `package.json` script in the same package,
  run once that profile is up. `@acme/billing` declares its localstripe seed
  there, which is why no script body names it.

Each module reads its own slice's `development-profile.ts` — the authored values,
in a module that runs no `createEnv` call — rather than its `env.ts`.
Provisioning wants what version control declares and never an operator's
override, and importing `env.ts` would evaluate the whole slice's env just to
read a mode
([@acme/env ADR 0001](../../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md) §6). The resolver runs via `pnpm exec tsx`
(not `node`) so those modules load.

The model stays uniform — **graph = candidate set, the closure's packages =
what to start and with what** — and it now holds for a workspace that took a
different set of packages: `@acme/workspace-graph` names none of them and
neither does any root script, so a checkout with no billing slice resolves no
`billing` profile and no seed instead of failing on an import. Adding a slice
with infra, a value or a seed touches that slice only. `infra:up` reuses the
same resolver with no app args (the union over every app) so the
standalone-infra command and dev can't drift.

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
- **Keeping the named inputs and making each one optional** — the resolver
  importing five slices' profiles by relative path, each import guarded. It was
  the smaller diff, and it leaves the coupling exactly where it was: the tooling
  package still knows five roles by name, every new slice with infra still edits
  it and a root script, and the relative imports into `packages/` survive as
  conditional ones that no static rule can then object to. Declaring the
  contribution in the package that owns it inverts that, and the absence of a
  package becomes the absence of a contribution with nothing to guard.
- **Declaring the compose values in `package.json` beside `acme.infra`**, so
  discovery needed no module load. Rejected — a port, a database name and a
  models pull list are already authored in the slice's
  `development-profile.ts`, which its `env.ts` reads; a second copy in the
  manifest is a drift source, and the two would disagree silently. The seed is
  in the manifest precisely because it is not a computed value: it is the name
  of a script that manifest already declares.
