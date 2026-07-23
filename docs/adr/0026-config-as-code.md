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

Config is **pure**: a `config.ts` module never reads `process.env` and never
reads `NODE_ENV`. `appEnv` and `isServer` arrive via an injected `context`. Each
slice exports a factory `xConfig(context)`; the **app resolves the context once
at its composition edge** — the single sanctioned `process.env.APP_ENV` read,
exactly where the app's `env.ts` already touches `process.env` — and threads it
into every slice through a `configExtends`-style list mirroring the existing
`extends: [chatEnv(), ingestEnv(), billingEnv()]` shape. **No thread-local /
module-init global** (it would break purity and testability). Tests construct
`xConfig({ appEnv: 'staging', isServer: true })` with no env at all.

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

## Open sub-decisions for implementation

Deferred to the build effort — they refine the mechanism but don't change this
decision:

- **Array-merge strategy** — the #79 prototype _replaces_ arrays; `ts-deepmerge`
  _concatenates_ by default. Pick one and configure the helper explicitly.
- **Client guard** — a throwing `Proxy` on server-only keys (prototype) vs
  omitting server keys from the client object structurally.
- **`isServer`** — injected via context vs a structural client/server split.
- **Authoring-time safety** — TS-check the raw profile literals against the shape,
  not just runtime validation.
- **`@acme/config` exports map + layer placement** — finalise against
  [ADR 0015](0015-package-exports-convention.md); assumed home
  `packages/platform/config`, tag `platform`.
- **`staticTestEnv`** — add `APP_ENV=development` explicitly to
  `tooling/test-utils` for clarity vs relying on the unset→development default.
- **Config error UX** — `ConfigValidationError(zodError)` is the raw shape; the
  human-facing surfacing is unspecified.

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

| Slice                    | Vars → `config.ts`                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@acme/models`           | `LLM_PROVIDER`, `EMBED_PROVIDER`, `EMBED_DIMENSIONS`, all `OLLAMA_*`/`BEDROCK_*`/`OPENROUTER_*` model IDs, `OLLAMA_BASE_URL`, `AWS_REGION`. Secrets (`OPENROUTER_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) stay in env. |
| `@acme/db` / `@acme/rag` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`, `DB_VECTOR_NAME`. `DB_PASSWORD` stays in env.                                                                                                                                             |
| `@acme/ingest`           | `S3_ENDPOINT`, `S3_UPLOAD_BUCKET`; `MAX_FILE_SIZE_BYTES`, `ACCEPTED_EXTENSIONS` (from source constants).                                                                                                                              |
| `@acme/rag`              | `CHUNK_SIZE`, `CHUNK_OVERLAP`; memory `lastMessages`, `semanticRecall`, title word-cap.                                                                                                                                               |
| `@acme/chat` / queue     | `INFLIGHT_LOCK_TTL`, `ABORT_SIGNAL_TTL`, `STREAM_POST_TERMINAL_TTL`, `STREAM_SAFETY_TTL`, `POLL_INTERVAL_MS`, `MAX_MESSAGE_LENGTH`, `CREDITS_PER_TURN`, queue `removeOnComplete/Fail`.                                                |
| `@acme/subscriptions`    | `CREDIT_LIMITS` per tier, `DEFAULT_LIMIT`.                                                                                                                                                                                            |
| telemetry                | `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` (+ default OTLP endpoint source constant).                                                                                                                                         |

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
  (`lazyConnect`, `maxRetriesPerRequest`), test-only DB defaults.

### Rollout / backward-compat

- Migrate slice-by-slice; each slice's `config.ts` + its removal from `.env.*`
  ships together. Config is additive until the env row is deleted, so a slice can
  run both briefly if needed.
- No data migration — this is a source/config move only.
- `NEXT_PUBLIC_WEBAPP` and `APP_ENV` stay in `process.env` throughout (selectors,
  per the principle).

## Status

proposed

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
