# Non-sensitive config is code, not env — `@acme/config` mirrors `@acme/env`

`process.env` today carries two unlike things: **secrets** (leak = access) and
**non-sensitive tunable values** that merely differ per deploy target (Clerk
routes, Stripe plan-IDs/publishable keys, model IDs, hosts/ports, TTLs). The
non-sensitive half is copy-pasted across all four apps' `.env.example` /
`.env.staging` / `.env.production` (audit: [#78](https://github.com/regybean/Trellis/issues/78))
and baked into the client bundle through per-env `.env.*` files that exist only
as the least-bad way to get `NEXT_PUBLIC_*` values into the build. That is a
config-as-code problem wearing an env costume: values that live in code, are the
same for every app in a given environment, and want schema validation + layering
— not a credential store.

This ADR decides how those values become **config-as-code**. It is planning
output: `@acme/config` is not yet built. The [Migration plan](#migration-plan)
below is the concrete, executable handoff for that follow-on effort. Charted via
the [config-as-code wayfinder map](https://github.com/regybean/Trellis/issues/76)
(research [#77](https://github.com/regybean/Trellis/issues/77), audit
[#78](https://github.com/regybean/Trellis/issues/78), prototype
[#79](https://github.com/regybean/Trellis/issues/79), semantics
[#80](https://github.com/regybean/Trellis/issues/80)).

## Decision

### 1. The principle — `process.env` = secrets **+ selectors**; config = the values selectors pick

> **Superseded in part by [ADR 0033](0033-one-env-factory-per-slice.md).** This
> section's decoupling claim no longer holds. It said a value is _either_ a
> `process.env` entry _or_ config-as-code, never both. Config's source of truth
> is still code, but `process.env` is now also an **override channel**: every key
> in a slice's env call can be set from the environment, and the authored profile
> value is what an _unset_ variable resolves to. Env can only retune a key the
> slice declares and a schema validates; it can never introduce one.
>
> **The credential-slot clause below is also superseded.** This section put
> "dev/test placeholders that occupy a credential slot" in `process.env`, on the
> reasoning that a key which is ever a real credential should never be authored
> in code. ADR 0033 §1 replaces that with a per-target rule, because the
> config/secret line is now drawn mechanically by whether a profile supplies a
> value — and a profile is per deploy target. So a throwaway that is not a
> credential _in development_ is authored in the `default` profile
> (`BILLING_DEVELOPMENT_PROFILE`'s localstripe `STRIPE_SECRET_KEY`,
> `@acme/ingest`'s LocalStack `AWS_ACCESS_KEY_ID: 'test'`), and the staging and
> production overlays **unauthor** it (`KEY: undefined`), which makes it a
> required secret on exactly the targets where it grants real access. The
> underlying rule is intact — nothing that grants access anywhere is authored for
> the target it grants access on — but the unit it applies to is a
> `(key, target)` pair, not a key.
>
> The rest of this section — what belongs in a credential store, and why the
> selector carve-out is narrow — stands unchanged, restated by ADR 0033 §1 as the
> mechanical rule "a key with no profile value is a secret".

A value stays in `process.env` iff it is a **secret** (leaking it grants
access/impersonation — API keys, passwords, signing secrets, and dev/test
placeholders that occupy a credential slot) **or** a **selector**, where a
selector satisfies _both_:

1. it picks a config profile, DB schema, or namespace, **and**
2. it is consumed **pre-composition** — at module load, in `drizzle.config.ts`,
   in a worker, or in build config — where no injected context exists.

Today the selector set is **exactly `{ APP_ENV, NEXT_PUBLIC_WEBAPP }`**.
Everything else non-sensitive is config. Both conditions are required so the
selector carve-out can't become a loophole to keep arbitrary values in env.

`APP_ENV` and `NEXT_PUBLIC_WEBAPP` are **two orthogonal axes**:
`NEXT_PUBLIC_WEBAPP` is app _identity_ (namespaces Postgres `pgSchema` + Redis,
[ADR 0008](0008-per-app-redis-namespace.md)); `APP_ENV` is deploy _target_
(selects the config profile). `WEBAPP`'s value happening to differ by
environment (`<appname>` in dev, `trellis` in staging/prod) does not make it the
same knob — it stays a `process.env` selector because it is consumed
pre-composition (`pgSchema()` at module scope, `drizzle.config.ts`, `worker.ts`,
`vite.config.ts`) and is the per-suite test-isolation key.

### 2. The mechanism — extend the incumbent factory pattern, don't adopt a library

> **Superseded by [ADR 0033](0033-one-env-factory-per-slice.md) §§1–2, 5, 7.**
> `@acme/config` is deleted: a slice declares config _and_ secrets in one
> `createEnv` call in one `env.ts`, and profile layering rides t3-env's
> `createFinalSchema` seam (`withProfiles` in `@acme/env`). Profiles themselves —
> the closed set, the deep-merge with arrays replacing, the typed literals — are
> unchanged and still `ts-deepmerge`.

`@acme/config` is a new platform leaf that mirrors `@acme/env`: a `createConfig`
factory shaped like `@t3-oss/env`'s `createEnv`, with `server` / `client` zod
shapes. Each slice owns a `config.ts` that reads like today's `env.ts`. This is a
centralised _pattern_ (a shared factory), not a central config file.

The only thing the incumbent `createEnv` pattern lacks is **profile layering**,
which is a ~15-line addition, not a library. Profiles are authored as plain typed
objects and deep-merged over the base with **`ts-deepmerge` v8** (ESM-native,
TypeScript-first, no `as`). Every off-the-shelf loader (c12, node-config,
convict, cosmiconfig, nconf) was rejected: all are runtime filesystem/env loaders
that drag Node built-ins into the bundle and lack zod — structurally wrong for
static, browser-safe, zod-validated config ([#77](https://github.com/regybean/Trellis/issues/77)).
zod itself only merges schema _shapes_, not layered _values_, so a value-level
merge helper is required regardless.

Shape (validated by the [#79](https://github.com/regybean/Trellis/issues/79)
prototype, approved):

```ts
export function billingConfig(context: ConfigContext) {
  return createConfig({
    server: { STRIPE_SUCCESS_PATH: z.string().startsWith("/") },
    client: {
      CLERK_SIGN_IN_URL: z.string().startsWith("/"),
      STRIPE_PRO_PLAN_ID: z.string(),
      BILLING_TRIAL_DAYS: z.coerce.number().int().positive(),
    },
    profiles: {
      default: {
        server: { STRIPE_SUCCESS_PATH: "/billing/success" },
        client: {
          CLERK_SIGN_IN_URL: "/sign-in",
          STRIPE_PRO_PLAN_ID: "price_dev_pro",
          BILLING_TRIAL_DAYS: "14",
        },
      },
      staging: { client: { STRIPE_PRO_PLAN_ID: "price_stg_pro" } },
      production: {
        client: {
          STRIPE_PRO_PLAN_ID: "price_live_pro",
          BILLING_TRIAL_DAYS: "7",
        },
      },
    },
    context,
  });
}
```

`createConfig` deep-merges the selected profile over `default`, feeds the merged
result through the zod shapes (coercion runs on the merge), and returns a guarded
object. Validation failures surface as `ConfigValidationError(zodError)` with
path + message.

### 3. Profiles — closed set, `development` is the base

The profile value-set is the **closed set `{ development, staging, production }`**.
`development` **is** the base (`profiles.default`) — there is no separate empty
base, and **no `preview`** (zero repo usage; it graduates later as a plain
overlay if ever needed). Test / CI / lint are validation-_contexts_, never
value-_profiles_.

The core mechanism carries **no per-app profile branching**. The old "only 2 of 4
apps have `.env.staging`/`.env.production`" asymmetry was an artifact of the
per-app `.env` world, not a mechanism constraint: config values are identical
across all four apps in a given environment (the dedup win), so they move into
**slice-owned, app-agnostic** profiles. `APP_ENV` is one global selector; every
profile is available to every app; an app that never deploys to an environment
simply never sets that `APP_ENV`. Any _future_ genuine per-app divergence (none
exists today — all apps are `trellis`) lives in an **app-level override layer
applied last at composition**, never by forking each app's profile set.

### 4. Purity + the arg-injection seam

> **Superseded by [ADR 0033](0033-one-env-factory-per-slice.md) §7.** A single
> `createEnv` call cannot be pure — it reads `runtimeEnv` — so the injected
> `ConfigContext` is gone and each slice resolves `APP_ENV` at its own `env.ts`
> edge, the file the ESLint guard already exempts. The two provisioning paths that
> depended on purity read a slice's `development-profile.ts` literal instead
> (ADR 0033 §6), so they still see the authored values and never an override.

Config is **pure**: a `config.ts` module never reads `process.env` and never
reads `NODE_ENV`. `appEnv` and `isServer` arrive via an injected `context`. Each
slice exports a factory `xConfig(context)`; the context is resolved at a
**sanctioned `env.ts` edge** — where the app (or a slice) already touches
`process.env` — and threaded in explicitly. **No thread-local / module-init
global** (it would break purity and testability). Tests construct
`xConfig({ appEnv: 'staging', isServer: true })` with no env at all.

There are two such edges. At **composition** the app resolves `APP_ENV` once and
threads it into every slice through a `configExtends`-style list mirroring the
existing `extends: [chatEnv(), ingestEnv(), billingEnv()]` shape. A slice that
consumes its **own** config server-side **pre-composition** — `createDb()`,
`resolve.ts`, a worker, where no injected context exists — instead resolves
`APP_ENV` at its own `env.ts`: `export const appEnv = resolveAppEnv(process.env.APP_ENV)`,
the same sanctioned kind of read as the app's `env.ts`, and builds its singleton
with `xConfig({ appEnv, isServer: true })`. That per-slice read is still a
per-edge read threaded explicitly — not a module-init global — and `config.ts`
stays pure either way. This "context-less server edge" convention is documented
in [`@acme/env`'s CONTEXT.md](../../packages/platform/env/CONTEXT.md) and is
what the shipped Phase-2 slices use.

`NODE_ENV` is deliberately not consulted: it is tooling-owned runtime-mode and
can't even express `staging` (staging builds run `NODE_ENV=production`).
`APP_ENV` is a new, standalone, us-owned deploy-target selector.

### 5. `APP_ENV` resolution — unset → `development`, unknown → throw

- **Unset → `development`** (the base), silently / debug-log — keeps local dev and
  tests ergonomic, and matches dev-is-base.
- **Unknown value → throw** `ConfigValidationError`; `APP_ENV` is validated
  against a zod enum. A typo (`prod`, `staging2`) must fail loud: because
  `NEXT_PUBLIC_*` config is **baked at build time**, a silent degrade could bake
  development config into a production image.
- **Build-time resolvability is required.** `.env.staging`/`.env.production`
  existed only to bake `NEXT_PUBLIC_*` into the client bundle; config-as-code
  replaces that — slice profiles + `APP_ENV` bake the chosen profile at build.
  So `APP_ENV` must be resolvable at build, not just runtime.
- **Residual risk** (a pipeline forgets to set `APP_ENV` for a prod build → gets
  `development`) is handled by a **deploy-pipeline convention + a CI guard**
  asserting `APP_ENV` is set for staging/prod image builds — _not_ by making
  `APP_ENV` mandatory always, which would tax every local and test run.

### 6. Config always validates — decoupled from `shouldSkipEnvValidation()`

> **Restated by [ADR 0033](0033-one-env-factory-per-slice.md) §3.** The guarantee
> survives: `skipValidation` is never passed anywhere, and the skip moved from
> per-call to per-key inside `withProfiles` — it relaxes exactly the keys with no
> profile value (the secrets) on a run that cannot supply one. Authored values are
> still always coerced and validated.

Config **always validates**, on a path that never calls and is never gated by
`shouldSkipEnvValidation()` ([ADR 0022](0022-centralized-env-validation-policy.md)),
even when co-running in the same wiring (e.g. the `next.config` jiti import where
env skips on `IS_NEXT_BUILD` but config still validates).

Env's skip matrix exists _solely_ because env's values come from `process.env`,
which is absent at build/lint/non-test-CI — the missing-var failure it guards
against **cannot occur for config**, whose values come from code. And **build is
exactly when client config must validate** (right before the bundle freezes), so
skipping there would defeat the purpose. This is safe across every context: lint
(`APP_ENV` unset → `development` validates), prod image build (pipeline sets
`APP_ENV=production` → validates + bakes), and tests (pure; consistent with
[ADR 0014](0014-tests-validate-real-env.md)'s "validate for real", needs no
testcontainers).

## Considered and rejected

- **`env = secrets only` (the original principle).** Too strict: it would force
  pre-composition selectors (`APP_ENV`, `NEXT_PUBLIC_WEBAPP`) into the config
  mechanism, which can't work where no injected context exists. Refined to
  "secrets + selectors" with the two-condition selector test.
- **Force `NEXT_PUBLIC_WEBAPP` into `@acme/config`.** Rejected: it is consumed
  pre-composition (`pgSchema()` at module scope, `drizzle.config.ts`, `worker.ts`,
  `vite.config.ts`) and is the test-isolation key — forcing it in would
  reintroduce a global or thread context through drizzle-kit and every schema
  module, and complicate test isolation. If ever pursued it is a separate, larger
  effort (solving pre-composition consumption), not part of this one.
- **An off-the-shelf config loader (c12, node-config, convict, cosmiconfig,
  nconf).** All are runtime FS/env loaders that pull Node built-ins into the
  bundle and lack zod; c12 has the best layering but is still a browser-unsafe
  runtime loader ([#77](https://github.com/regybean/Trellis/issues/77)).
- **`deepmerge` as the merge helper.** CJS-only (its ESM entry was dropped over a
  Webpack bug), unpublished since 2023; `ts-deepmerge` is the ESM/TS-native
  replacement.
- **`NODE_ENV` as the profile selector.** Tooling-owned, can't express `staging`;
  `APP_ENV` is decoupled and us-owned.
- **Silent fallback on unknown `APP_ENV`** (the #79 prototype's behaviour).
  Rejected in favour of throw — a silent degrade could bake dev config into a
  prod bundle.
- **Dynamic/remote runtime config** (a config service, hot-reload,
  LaunchDarkly-style flags). Out of scope; this is static config-as-code only.

## Sub-decisions — resolved in Phase 0 (#93)

These refined the mechanism without changing the decision; resolved while
building `@acme/config`:

- **Array-merge strategy** — arrays **replace**, not concatenate
  (`merge.withOptions({ mergeArrays: false }, …)`). An overlay that sets a list
  means "use this list", not "append to the base's".
- **Client guard** — a **throwing `Proxy`** on server-only keys (not structural
  omission). Reading a server key on the client throws loudly; the return type
  is uniform across contexts, so no conditional-on-`isServer` type is needed.
  Validation itself is context-independent (the merged shape always validates);
  only _access_ is guarded.
- **`isServer`** — **injected via `context`** (keeps the module pure — no
  `window`/`NODE_ENV` sniffing inside config). The app resolves it once at its
  edge (via `@tanstack/react-query`'s `isServer`).
- **Authoring-time safety** — profile literals are typed against **`z.input`** of
  each shape's schema, so a wrong literal is a compile error. Runtime zod
  validation still enforces base-profile completeness (loose only for coerced
  fields, whose input is `unknown`).
- **`@acme/config` exports map + layer placement** — home
  `packages/platform/config`, tag `platform`, single `.` export
  ([ADR 0015](0015-package-exports-convention.md)). Slices surface their factory
  under a new `./config` role, registered in `scripts/check-exports.mjs`.
- **`staticTestEnv`** — `APP_ENV=development` added explicitly to
  `tooling/test-utils`.
- **Config error UX** — `ConfigValidationError` wraps the `ZodError` and renders
  `z.prettifyError(zodError)` in its message; `.zodError` stays available for
  structured detail.
- **`APP_ENV` build-time resolvability** — inlined into the client bundle via
  each framework's build config (Next `env`, Vite `define`), so the selected
  profile bakes identically server- and client-side. A Dockerfile guard fails a
  staging/production image build whose `APP_ENV` is unset/invalid.

## Sub-decisions — resolved in Phase 1 (#94)

Phase 0 only had one config consumer (`authConfig`), read **at the app edge**
(`<ClerkProvider>` props). Phase 1 (`@acme/billing` + the Clerk publishable key)
is the first slice whose values are consumed **deep in feature runtime**, on both
the client and the server — which forced the consumption seam the rest of the
migration follows. Resolved while building it:

- **Feature config-consumption seam.** A feature never resolves `APP_ENV` or
  builds its own config singleton (that would be the banned module-init global).
  The app resolves the composed `config` once at its edge and threads it in two
  ways, reusing seams that already exist:
  - **Client:** a slice ships a React provider + hook
    (`BillingConfigProvider` / `useBillingConfig`), mounted at the app edge with
    the composed `config`. Components/hooks read config through the hook; a
    module-const that baked a value at import (e.g. `pricingPlans`) becomes a
    builder taking the resolved values (`buildPricingPlans(planIds)`).
  - **Server:** config rides the **existing injection points**, not a new
    thread-through-every-call. The product→tier plan IDs are injected via the
    `createSubscriptionsEntitlements(planIds)` factory through the ADR 0006
    entitlements seam (so `@acme/subscriptions`' `credits`/`getSubscriptionType`
    take the resolved values, never env); the Clerk publishable key is passed to
    `clerkMiddleware({ publishableKey })`. A dev-only admin path (`setUserTier`)
    takes the target `productId` from the client mutation rather than adding a
    server plan-ID source.
- **What stays in `env` (not every listed var migrates).** `STRIPE_API_BASE` (the
  dev-only localstripe switch, read pre-composition by the `getStripe` SDK
  singleton and the seed script) and `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL`
  (server-only checkout redirects, injected per deploy — they had **no committed
  staging/production values** to author as profiles) stay in `process.env`. The
  dedup win — the values copy-pasted across every app's `.env.*` — is the
  `NEXT_PUBLIC_*` client set, and that is what migrated.
  - **Follow-up (#146): these three also became config.** The Phase-1 carve-out
    was reversed once `#124` (`REDIS_URL`) established that a value read by a
    module-init singleton can still be config-as-code. `STRIPE_API_BASE` became a
    **discriminated union** `stripe: { mode: 'localstripe', apiBase } | { mode:
'real' }` (illegal states unrepresentable; the `real` overlay strips the
    inherited `apiBase` on merge), and the checkout redirects **decomposed**:
    their env-invariant path/query → config (`checkoutSuccessPath`/
    `checkoutCancelPath`), their per-app origin → threaded at the app edge. These
    three are **server-only**. They first lived in a second, server-only
    `stripeConnectionConfig` factory, on the reasoning that the client
    `billingConfig` is Flight-serialized wholesale across the RSC boundary so a
    server key on it would bake into the browser payload. **Superseded (#146
    follow-up): merged back into a single `billingConfig` with both a `client` and
    a `server` shape.** `createConfig` already supports one config carrying both
    (the client guard throws on a server-key read on the client), so the split was
    never a platform limit — only that one wholesale-threaded prop. The invariant
    is now preserved at the seam instead: the app narrows the composed config to
    its client keys with `toBillingClientConfig(config)` before passing it into
    `<BillingConfigProvider>` (mirrors `toPlanIds`), so server keys never cross the
    Flight boundary. A slice owns **one** config; only the Stripe secrets remain in
    `env`.
- **Clerk publishable key is config.** Public but per-deploy-target, so it joins
  `authConfig` (dev/staging/production profiles) and is fed to `<ClerkProvider>` +
  `clerkMiddleware`. Only `publishableKey` is passed to middleware — passing
  `secretKey` would flip Clerk into Dynamic Keys mode and require
  `CLERK_ENCRYPTION_KEY` — so `CLERK_SECRET_KEY` stays env. The Next.js Edge
  middleware resolves just the `authConfig` slice (not `~/env`), so the
  feature-env `createEnv` graph never executes in the Edge runtime. Residual: the
  TanStack Start server SDK's need for the bare `CLERK_PUBLISHABLE_KEY` is
  unverified in docs, so that env var is kept as a safety net pending a staging
  auth smoke test.
- **`.env.staging`/`.env.production` retired.** Once every `NEXT_PUBLIC_*` baked
  into the client bundle is config-as-code (baked via `APP_ENV`), those files held
  only the `NEXT_PUBLIC_WEBAPP` selector (now a Dockerfile `ENV`) and a dead
  `SKIP_ENV_VALIDATION` (build-skip runs off `IS_NEXT_BUILD`). All four files are
  deleted and the Dockerfile `dotenv -e .env.<stage>` load removed. `APP_ENV`
  joins `turbo.json` `globalEnv` — it is now the build-cache discriminator that
  the per-env `NEXT_PUBLIC_*` used to be.

## Sub-decisions — resolved in Phase 3 (#96)

Phase 3 closes the migration: the one ambiguous call (`REDIS_URL`), the stragglers
not in the ADR tables, and the final `turbo.json`/`.env` sweep. No new config
mechanism — just classification and cleanup.

- **`REDIS_URL` stays whole in `env`, treated as a secret.** The split (host/port/
  db-index → config + `REDIS_PASSWORD` → env secret) was rejected: a prod DSN
  embeds the password inseparably (`redis://:pw@host:port/db`), so the "non-secret
  parts" only exist in dev; and the split touches every Redis client
  (`@acme/redis,queue,chat,feedback,billing`) plus the test harness for marginal
  config coverage — not cheap, per the ticket's "only if cheap" bar. `REDIS_URL`
  therefore remains a single `process.env` secret; no Redis client changed.
  - **Follow-up (#124): `REDIS_URL` gains a config home as the whole DSN.** The
    Phase-3 call above kept the _split_ rejected but left `REDIS_URL` with no
    config default, so it still had to sit in every dev `.env`. #124 revisits the
    _non-split_ half: the committed value is `redis://localhost:6379` — no
    embedded password, non-secret — so the whole DSN moves to `@acme/redis`'s new
    `redisConfig` (base default `redis://localhost:6379`), mirroring `dbConfig`
    exactly. `env.ts` layers a runtime `process.env.REDIS_URL` override for the
    _dynamic_ case only (testcontainer mapped port, infra-injected prod endpoint,
    which may embed a password) — the same host/port-override shape `dbConfig`
    uses. `@acme/redis` is the single config home; the dead, unused `REDIS_URL`
    rows in `@acme/chat,feedback,billing` env schemas were dropped, and
    `@acme/queue` now sources the DSN from `@acme/redis/env` (as `@acme/rag`
    sources DB from `@acme/db/env`). `REDIS_URL` leaves `.env.example`; it stays
    in `turbo.json` `globalEnv` as a dynamic override read (like `DB_HOST`/
    `DB_PORT`). Dev runs with no `REDIS_URL` row.
- **Stragglers classified** (named in #78 but outside the ADR tables). None become
  config-as-code — config is a browser-safe TypeScript runtime, so a value that is
  only ever read by a shell script or a compose file cannot consume it:
  - **`SECRETS_BACKEND`** — a shell-tooling _selector_ (`localstack`/`aws`) read
    only by the `scripts/secrets-backends/*` bash and `env:pull`/`env:push`,
    pre-composition. Stays in the shell env; never entered the app runtime or
    `globalEnv`.
  - **`REDIS_PORT`, `OLLAMA_PORT`** — infra/compose-only vars (`compose.yaml`
    port maps, `ollama pull`), never in an app `createEnv` schema or `globalEnv`.
    Stay as compose env.
  - **`PORT`** — a runtime deploy _signal_ (per-app dev/prod server port, and the
    tRPC client base-URL fallback `http://localhost:${PORT ?? 3000}`), consumed
    pre-composition at server bootstrap / client-URL construction and assigned by
    the platform at runtime — not a per-target value authored in code. Stays in
    `env`/`globalEnv`.
- **`turbo.json` `globalEnv` swept.** `DB_NAME` and `DB_USER` dropped — they are
  now pure config-as-code (`dbConfig`), with no functional `process.env` read (the
  only remaining reads are `compose.yaml` provisioning `POSTGRES_*` and a
  diagnostic log line, neither a turbo-task input). A duplicate `APP_ENV` entry was
  removed. The residual non-secret entries are **intentional, documented
  carve-outs, not misses**: `DB_HOST`/`DB_PORT` are _dynamic runtime overrides_
  (a testcontainer's mapped port, an infra-injected prod endpoint) layered over the
  config defaults — genuine `process.env` reads that must stay cache-tracked;
  `STRIPE_API_BASE`/`STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL` are the Phase-1
  server-only/pre-composition carve-outs; `PORT` is the runtime signal above.
  Everything else is a secret (`DB_PASSWORD`, `CLERK_*`, `STRIPE_SECRET_KEY`/
  `STRIPE_WEBHOOK_SECRET`, `REDIS_URL`, `NPM_TOKEN`) or a build/Node signal
  (`APP_ENV`, `NEXT_PUBLIC_WEBAPP`, `IS_NEXT_BUILD`, `NODE_*`, `WATCHPACK_POLLING`,
  `REACT_EDITOR`).
- **`.env.example` needs no further cleanup.** The per-slice row deletions shipped
  with Phases 1–2; what remains is already reduced to secrets, infra/compose-
  consumed provisioning values (`DB_*`, `REDIS_PORT`/`REDIS_PASSWORD`,
  `OLLAMA_PORT`/model IDs, `DB_VECTOR_NAME` — read by `compose.yaml` + the
  `ops/db-init` / Docker entrypoint shell, not the app), and the Phase-1 carved
  Stripe runtime URLs.
- **Code-constant carve-outs reaffirmed** (per the Phase-3 migration-plan bullet):
  UI layout/timers, identifiers (`TEXT_NODE_NAMESPACE`, `QUEUE_NAMES`,
  `KNOWLEDGE_BASE_TABLE`), infra flags (`lazyConnect`, `maxRetriesPerRequest`),
  test-only DB defaults, and the env-invariant validation limits
  (`MAX_MESSAGE_LENGTH`, `MAX_FILE_SIZE_BYTES`, `ACCEPTED_EXTENSIONS`) stay source
  constants — no per-target variance, so not config.
- **`APP_ENV` CI guard verified (regression).** The staging/production image guard
  built in Phase 0 still fails an image build whose `APP_ENV` is unset/invalid —
  `apps/nextjs/Dockerfile` and `apps/nextjs-slim/Dockerfile` (`case "$APP_ENV" in
staging|production) … *) exit 1`). The two TanStack apps ship no Dockerfile;
  their `APP_ENV` is baked at build via Vite `define`.

### Post-completion corrections (follow-up)

Two claims above were overstated and were corrected after the migration was
declared complete:

- **The straggler dividing line has an exception: Node infra scripts.** The rule
  "a value only ever read by a shell script or a compose file cannot consume
  config" is right for shell/compose, but `scripts/resolve-infra.ts` (which prunes
  the `ollama` compose profile) is a **Node** script — it _can_ import config via
  `pnpm exec tsx` (the `resolve-ollama-models.ts` precedent). It was still reading
  `LLM_PROVIDER`/`EMBED_PROVIDER` from `process.env` after Phase 2 moved them to
  `modelsConfig`, so on a fresh clone (no `.env` rows) it silently pruned `ollama`
  despite ollama being the default provider. Fixed: it reads `modelsConfig` now.
  The refined line is "shell/compose can't consume config, but a Node build/infra
  script can — and therefore must, once the value it reads is config."
- **"`.env.example` needs no further cleanup" was false for the slim apps.** Both
  `*-slim/.env.example` still carried dead `CLERK_*` + `STRIPE_*` blocks even
  though the slim apps compose neither auth nor billing env (ADR 0010). Removed —
  their `.env.example` is now selectors-only, which _demonstrates_ the ADR 0010
  subset rather than contradicting it.

## Migration plan

Concrete, executable handoff for the follow-on build effort. Ordered so each step
is independently shippable and low-risk. Full classified inventory in the
[audit](https://github.com/regybean/Trellis/issues/78).

### Phase 0 — build the mechanism

1. Scaffold `packages/platform/config` (tag `platform`, `sideEffects: false`,
   exports map per [ADR 0015](0015-package-exports-convention.md)). Add
   `ts-deepmerge` v8 to the workspace catalog.
2. Implement `createConfig` + `ConfigValidationError` + the `APP_ENV` zod enum
   (`development | staging | production`, unset→`development`, unknown→throw).
   Resolve the [open sub-decisions](#open-sub-decisions-for-implementation)
   (array-merge, client guard, authoring-time typing) here.
3. Add the app-side `configExtends` composition helper mirroring `env.ts`'s
   `extends`; the app resolves `process.env.APP_ENV` once at its edge.
4. Establish the CI guard: staging/prod image builds must set `APP_ENV`.

### Phase 1 — the dedup win (highest value, ships first)

The clearest payoff: values duplicated across **all four apps'** `.env.*` collapse
into one slice-owned profile set.

| Slice                                     | Vars → `config.ts` (profile)                                                                                                                                                                   | Notes                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@acme/billing` (+ `@acme/subscriptions`) | `STRIPE_STANDARD_PLAN_ID`, `STRIPE_PRO_PLAN_ID` (per-env), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SUCCESS_URL`/`CANCEL_URL`, `NEXT_PUBLIC_STRIPE_MANAGE_BILLING_URL`, `STRIPE_API_BASE` | plan-IDs + publishable key vary per env → the canonical profile example. Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) stay in env.                                   |
| app auth wiring                           | `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `_SIGN_UP_URL`, `_SIGN_IN_FORCE_REDIRECT_URL`, `_SIGN_UP_FORCE_REDIRECT_URL`                                                                                  | static routes, identical everywhere, do **not** vary per env → base profile only. `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` stay in env; publishable keys are config. |

After Phase 1, delete the migrated rows from every `.env.example` /
`.env.staging` / `.env.production`; confirm `.env.staging`/`.env.production` are
now largely empty (they existed only to bake these) and remove the ones that are.

### Phase 2 — per-slice tunables

| Slice                    | Vars → `config.ts`                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@acme/models`           | `LLM_PROVIDER`, `EMBED_PROVIDER`, `EMBED_DIMENSIONS`, all `OLLAMA_*`/`BEDROCK_*`/`OPENROUTER_*` model IDs, `OLLAMA_BASE_URL`, `AWS_REGION`. Secrets (`OPENROUTER_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) stay in env.                                                 |
| `@acme/db` / `@acme/rag` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`, `DB_VECTOR_NAME`. `DB_PASSWORD` stays in env.                                                                                                                                                                                             |
| `@acme/ingest`           | `S3_ENDPOINT`, `S3_UPLOAD_BUCKET`. (`MAX_FILE_SIZE_BYTES`, `ACCEPTED_EXTENSIONS` reclassified as env-invariant validation limits → stay code constants, Phase-3 carve-out.)                                                                                                           |
| `@acme/rag`              | `CHUNK_SIZE`, `CHUNK_OVERLAP`; memory `lastMessages`, `semanticRecall`, title word-cap.                                                                                                                                                                                               |
| `@acme/chat` / queue     | `INFLIGHT_LOCK_TTL`, `ABORT_SIGNAL_TTL`, `STREAM_POST_TERMINAL_TTL`, `STREAM_SAFETY_TTL`, `POLL_INTERVAL_MS`, `CREDITS_PER_TURN`, queue `removeOnComplete/Fail`. (`MAX_MESSAGE_LENGTH` reclassified as an env-invariant validation limit → stays a code constant, Phase-3 carve-out.) |
| `@acme/subscriptions`    | `CREDIT_LIMITS` per tier, `DEFAULT_LIMIT`.                                                                                                                                                                                                                                            |
| telemetry                | `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` (+ default OTLP endpoint source constant).                                                                                                                                                                                         |

### Phase 3 — decide `REDIS_URL`, then finish env cleanup

- **`REDIS_URL`** is the one ambiguous var — a DSN that may embed a password.
  Decide: keep whole in env (simplest, treat as secret), **or** split
  host/port/db-index → config + `REDIS_PASSWORD` → env secret. The split earns
  more config coverage but touches every Redis client (`@acme/redis,queue,chat,
feedback,billing`); recommend keeping whole in env unless the split is cheap.
- **`turbo.json` `globalEnv`** shrinks: every 🟢 var migrated out of `process.env`
  drops from cache-key tracking, leaving only secrets + build signals
  (`IS_NEXT_BUILD`, `NEXT_PHASE`, CI/Vercel pass-through). Prune it as vars leave.
- **Leave as code constants** (not config — structural, not env-varying): UI
  layout/timers (`SIDEBAR_*`, `MOBILE_BREAKPOINT`, redirect delays), identifiers
  (`TEXT_NODE_NAMESPACE`, `QUEUE_NAMES`, `KNOWLEDGE_BASE_TABLE`), infra flags
  (`lazyConnect`, `maxRetriesPerRequest`), test-only DB defaults, and
  **env-invariant validation limits** — `MAX_MESSAGE_LENGTH` (chat),
  `MAX_FILE_SIZE_BYTES` / `ACCEPTED_EXTENSIONS` (ingest): bounds enforced
  identically in every environment and read in client-safe schema/validation
  barrels, so they stay code constants rather than per-target config (the
  Phase-2 table originally slated these — reclassified here).

### Rollout / backward-compat

- Migrate slice-by-slice; each slice's `config.ts` + its removal from `.env.*`
  ships together. Config is additive until the env row is deleted, so a slice can
  run both briefly if needed.
- No data migration — this is a source/config move only.
- `NEXT_PUBLIC_WEBAPP` and `APP_ENV` stay in `process.env` throughout (selectors,
  per the principle).

## Status

accepted — migration complete, then **superseded in part** by
[ADR 0033](0033-one-env-factory-per-slice.md) (§§2, 4, 6 above; §§1, 3, 5 stand). Phase 0 (the `@acme/config` mechanism + app
composition edge) built in #93; Phase 1 (the billing/Stripe + Clerk
publishable-key dedup, and the retirement of `.env.{staging,production}`) in #94;
Phase 2 (the remaining per-slice tunables) in #95; Phase 3 (the `REDIS_URL`
keep-whole decision, straggler classification, and the final `turbo.json`/`.env`
sweep) in #96.

## Consequences

- A new platform leaf `@acme/config` and one new runtime dependency
  (`ts-deepmerge`) — mirrors the `@acme/env` mental model, no parallel subsystem.
- `.env.example` / `.env.staging` / `.env.production` shrink to secrets +
  selectors; most `.env.staging`/`.env.production` files can be deleted.
- `turbo.json` `globalEnv` shrinks as config leaves `process.env`.
- Apps gain a second composition edge (`configExtends`) alongside `env.ts`'s
  `extends`, and resolve `APP_ENV` once there.
- A CI guard is required so staging/prod builds can't silently bake the
  `development` profile.
- Building `@acme/config` and executing the migration is a follow-on effort; this
  ADR is the spec it slices into tickets.

## Follow-ups

- **`@acme/models` provider config is a discriminated union per role (#125).** The
  Phase-2 flat models config (`LLM_PROVIDER`/`EMBED_PROVIDER` enums beside every
  provider's fields) let a selection carry — and required — fields it never uses
  (a Bedrock `region` while on Ollama), and made no-embed a runtime `throw`. It
  became `chat`/`embed` as `z.discriminatedUnion('provider', …)`: selecting a
  provider validates only that provider's variant; OpenRouter is absent from the
  `embed` union, so no-embed is structurally unrepresentable (the resolver throw is
  deleted) and an OpenRouter embed selection fails at parse time. The shared
  connection params (`baseUrl`, `region`) are single-authored via a TS const spread
  into each variant, and the embed dimension moved onto the selected variant
  (`embed.dimensions`, read by `@acme/rag`'s documents-schema). A profile overlay
  flipping a role's provider per deploy target (dev `ollama` → prod `bedrock`)
  merges cleanly: deep-merge carries the Ollama-only `baseUrl` into the merged
  object and the union strips it (zod object-strip) when the Bedrock variant
  validates. This is the first config to exercise `createConfig` with a
  discriminated-union schema — confirming the object-strip merge semantics hold for
  unions, not just flat shapes.
- **Compose derives its provisioning inputs from config (#126).** The Phase-3
  straggler ruling kept `REDIS_PORT`/`OLLAMA_PORT` and the `DB_*` provisioning
  values as compose-only env — true for the compose _file_, but the refined
  "a Node build/infra script can (and must) consume config" line applies: a Node
  resolver run by `scripts/compose.sh` can import the configs, so those rows need
  not sit in `.env` at all. `scripts/resolve-compose-env.ts` (superseding
  `resolve-ollama-models.ts`) now exports every value compose interpolates —
  `DB_PORT`/`DB_USER`/`DB_NAME` (`dbConfig`), `DB_VECTOR_NAME` (`ragConfig`),
  `REDIS_PORT` (parsed from `redisConfig`'s `REDIS_URL`), `OLLAMA_PORT` (parsed
  from the ollama role variant's `baseUrl`), and the ollama pull IDs
  (`modelsConfig`). Ports are **parsed from the connection URLs**, never stored as
  standalone fields — a second port field would be a drift source. `compose.yaml`
  drops the `:-` fallbacks for these rows (config is the sole source; a missing
  export fails loud), and the rows leave `.env.example` — collapsing the former
  triple-sourcing (config default ↔ compose `:-` default ↔ `.env` literal) to one.
  The container-password secrets (`DB_PASSWORD`, `REDIS_PASSWORD`) stay in `.env`.
  Same change fixed `resolve-infra.ts`, which was still reading the pre-#125
  `LLM_PROVIDER`/`EMBED_PROVIDER` off `modelsConfig` (gone under the union) and so
  silently pruned the `ollama` profile on a fresh clone; it now reads
  `config.chat.provider`/`config.embed.provider`.
- **Dev-deployment moves into `deploy/`; env splits infra vs app (#127).**
  _Partly superseded by [ADR 0029](0029-per-app-env-ownership.md): the shared root
  `.env` described below was later deprecated — each app now owns its full
  application env in `apps/<app>/.env`. The `deploy/.env` infra split stands; only
  the root application `.env` and the `dotenv -e ./.env -e ./deploy/.env` layering
  changed (root `with-env` now loads `deploy/.env` alone)._ With the
  provisioning inputs derived (#126), the only non-derived infra values left in
  `.env` were the container-password secrets — still tangled with the app's own
  secrets in one root file. #127 makes the "how the dev stack is stood up" vs "how
  the app runs" divide legible on disk. The dev-deployment concern moves into a
  self-contained `deploy/`: `compose.yaml` + its mounted assets (`ops/db-init`,
  `ops/jaeger`, `localstack-init.sh`), run via `-f deploy/compose.yaml
--project-directory deploy` so the in-file relative paths (`./ops/*`,
  `./localstack-init.sh`, `env_file: ./.env`) resolve local to `deploy/`. Env splits
  into two disjoint files: `deploy/.env` owns the container secrets (`DB_PASSWORD`,
  `REDIS_PASSWORD`); root `.env` owns app secrets + the `STRIPE_API_BASE` selector.
  `with-env` = `dotenv -e ./.env -e ./deploy/.env --` loads both, so the passwords
  are single-sourced in `deploy/.env` yet read by both compose (interpolated at
  parse time) and the app (its Postgres/Redis clients); keys are disjoint, so
  load-order precedence is immaterial. Root `.env.example` is thereby reduced to app
  secrets + `STRIPE_API_BASE`; a `deploy/.env.example` carries the infra secrets, is
  wired into the `env:pull`/`env:push` `SECRET_MAP` (`infra`), and is symlinked into
  linked worktrees alongside root `.env` (`link-worktree-env.mjs`). The compose
  project name becomes `deploy` (volumes `deploy_pg_data`/`deploy_ollama_data`) — a
  one-time dev reprovision, harmless since dev accepts infra data loss and the
  containers carry fixed `container_name`s. `@acme/db`'s test bindMount `repoPath`
  followed the assets to `deploy/ops/db-init`.
- **Two-axis secret validation; the Clerk gap closed (#165).** The secret/config
  split above left _when_ a secret is required implicit. Made it a rule: a secret's
  requiredness is never a permissive `.optional()` — it is decided on one of two
  axes, and each secret is validated exactly when its consumer is active. The
  **value axis** — a config discriminant selects _which_ secret within one app:
  `@acme/models`' scattered per-provider `bedrockEnv()`/`openrouterEnv()`
  side-effect calls collapsed into a single `modelsEnv(config)` (called once
  eagerly in `resolve.ts`) whose required set is derived from `config.chat`/
  `config.embed` (OpenRouter chat → `OPENROUTER_API_KEY`; Bedrock chat/embed → the
  AWS creds; Ollama → none), preserving fail-fast-at-import. The **composition
  axis** — whether the app mounts the slice at all: this closed a real gap where
  `CLERK_SECRET_KEY` was validated _nowhere_ (the Clerk SDK read it implicitly from
  `process.env`, so a full app missing it failed on the first Clerk call, not at
  boot). A validation-only `authEnv()` (mirroring `bedrockEnv()`; the key is not
  passed to Clerk) now lives in `@acme/auth/env`, composed by the two full apps
  only — the `*-slim` apps mount no auth (ADR 0010), so they never demand it. No
  `*.enabled` config toggle was introduced: activation stays the dependency graph,
  not a second source of truth. The dead `CLERK_WEBHOOK_SIGNING_SECRET` (no handler,
  no source reference) was dropped from both full apps' `.env.example`. Principle
  recorded in [`@acme/env`'s CONTEXT.md](../../packages/platform/env/CONTEXT.md).
