# `@acme/config` — config-as-code

Non-sensitive, per-deploy-target tunable values live in code here, not in
`process.env`. `process.env` is reserved for **secrets + selectors**; config is
the values a selector picks. See [ADR 0026](../../../docs/adr/0026-config-as-code.md).

Code is the source of truth, but not the last word. Any config value is
**overridable by an environment variable of the same name**, so an image is built
once and retuned per deploy: at runtime for server config, at build time for
client config. See [ADR 0033](../../../docs/adr/0033-config-values-env-overridable.md)
and [Overriding config from the environment](#overriding-config-from-the-environment).

## Ubiquitous language

- **Config** — a static, non-sensitive, zod-validated value that differs per
  deploy target (Clerk route URLs, Stripe plan IDs, model IDs, hosts, TTLs).
  Authored in code, identical across all apps in a given environment.
- **Selector** — a `process.env` var that picks a profile/schema/namespace and is
  read pre-composition (module load, `drizzle.config.ts`, a worker). Today the
  set is exactly `{ APP_ENV, NEXT_PUBLIC_WEBAPP }`. Not config.
- **`APP_ENV`** — the deploy-target selector: `development | staging | production`.
  Unset → `development` (the base); unknown → throws. Orthogonal to `NODE_ENV`.
- **Profile** — a named layer of values. `default` **is** `development`; `staging`
  and `production` are overlays deep-merged over it (arrays replace, not concat).
- **Context** — the injected `{ appEnv, isServer, overrides }` a slice's config
  factory receives. Config is **pure**: it never reads `process.env`/`NODE_ENV` —
  the app resolves the context once at its edge and threads it in.
- **Override** — an environment variable of the same name as a config key, which
  replaces the profile value. Applied after profile merging and before
  validation, so it is coerced and checked like any authored value.
- **Override path** — the `__`-joined address of a scalar leaf inside a nested
  config value: `stripe__apiBase`, `CREDIT_LIMITS__Pro`, `replicas__1__weight`.
  A config key may never contain a literal `__` (lint-enforced), so the split is
  unambiguous.
- **Lane** — which side an override applies to, and therefore when it is sampled.
  The server lane is read from `process.env` at runtime. The client lane is
  inlined by the bundler at build time and frozen in the image.
- **Coercion-tolerant** — a leaf schema that accepts the string an environment
  hands over: `z.string()`, `z.url()`, `z.enum()`, `z.coerce.number()`,
  `coercedBoolean()`. A bare `z.number()` / `z.boolean()` is not, and fails
  `pnpm lint`.

## Surface

- `createConfig({ server, client, profiles, context })` — merge the `APP_ENV`
  profile over `default`, validate through the zod shapes (coercion runs on the
  merge), return a guarded object. Reading a `server` key on the client throws.
- `configExtends([...])` — compose several slice configs into one flat object at
  the app edge, mirroring `env.ts`'s `extends: [...]`.
- `resolveAppEnv(raw)` — the app's edge turns `process.env.APP_ENV` into a
  validated `AppEnv`.
- `serverConfigContext(env)` — the context for a server edge: deploy target plus
  the server override lane.
- `appConfigContext({ appEnv, clientOverrides, serverEnv })` — the context for an
  app edge, which needs both lanes.
- `coercedBoolean()` — an override-safe boolean leaf.
- `describeConfig(config)` / `clientOverrideBuildEnv(config, env)` — derive what
  is overridable, for the lint gate and the bundler configs.
- `ConfigValidationError` — wraps the `ZodError`; message is `z.prettifyError`.

## Overriding config from the environment

Any value is retunable by a variable of the same name (ADR 0033). Precedence,
override last:

```
default profile → APP_ENV overlay → env override → validate
```

```bash
DB_PORT=6543                                  # scalar, by bare name
stripe__apiBase=http://localhost:9000         # nested object, __-joined path
CREDIT_LIMITS__Pro=4000                       # record entry, by key
store__mode=remote store__region=eu-west-2    # union flip: discriminant + fields
replicas__1__weight=9                         # array element, by position
```

Rules worth knowing before you use it:

- **Unset or empty falls through.** `FOO=` is not an override of `''`; the
  profile value stands.
- **A union flips only if the target variant is complete.** Set the discriminant
  and that variant's required fields. Zod strips the previous variant's leftovers.
  An incomplete flip fails validation loudly.
- **Arrays: profiles replace, overrides patch.** A `staging` or `production`
  overlay that sets an array replaces it wholesale. `KEY__1__field` patches
  element 1 in place and leaves its siblings alone. Two semantics in one system,
  unavoidable with index addressing, so ADR 0033 §4 calls it out rather than
  reconciling it.
- **Sampling time differs by lane.** Server config is read from `process.env` at
  **runtime**, so set it on the container and restart. Client config is inlined at
  **build** time and frozen in the image, so its override has to be set when the
  bundle is built. Setting it on a deployed container does nothing. Client leaf
  names are derived into each app's `env` or `define` map and into `turbo.json`
  `globalEnv`, which is what busts the build cache.
- **Secrets are not overridable config.** They stay in `env.ts`. Three things
  hard-fail `pnpm lint` via `scripts/check-config-overrides.ts`: a config key that
  collides with a secret-env key or with `APP_ENV` / `NEXT_PUBLIC_WEBAPP`, a leaf
  that is not coercion-tolerant, and a `__` inside a key name.

## Config-conditional secret validation (config ↔ env)

Secrets stay in `process.env` (never config — config bakes into the client
bundle, is pure, and always-validates; secrets do none of those). But **a
secret's _requiredness_ is a function of what the app actually assembles** — it
is never a permissive `.optional()`. Two axes decide "is this secret's consumer
active?":

- **Config-value axis** — a config discriminant selects _which_ secret is needed
  **within one app**. `@acme/models` is the exemplar: `config.chat.provider ===
'openrouter'` requires `OPENROUTER_API_KEY`; a Bedrock role requires the AWS
  creds; Ollama (default) requires none.
- **Composition axis** — whether the app _mounts the slice at all_ decides
  whether its secrets are required. `@acme/billing` / `@acme/auth`: a full app
  composes them (Stripe/Clerk secrets required, fail-fast at boot); a slim app
  never depends on them (ADR 0010), so their secrets are never demanded. There is
  **no** `billing.enabled` / `auth.enabled` config toggle — activation is the
  dependency graph, not a config flag (inventing one would duplicate ADR 0010's
  subsetting and create a second source of truth).

The invariant: **no secret is validated permissively; each is validated exactly
when its consumer is active, per the resolved config (value axis) or per
composition (composition axis).** A slice that owns secrets co-declares its
secret-env next to its `config.ts` so config and its gated secret can't drift
apart (the failure this guards against: `authConfig` once shipped with no secret
validation at all).

## Context-less server edges (slice-internal consumption)

A slice that consumes its **own** config server-side (not at the app edge —
`createDb()`, `resolve.ts`, a worker) resolves the context at its sanctioned
`process.env` edge, its `env.ts`: `export const appEnv =
resolveAppEnv(process.env.APP_ENV)`, exactly as the app's `env.ts` does. The
slice's runtime module then builds the singleton with `xConfig({ appEnv,
isServer: true })`. `config.ts` stays pure (it never reads `process.env` — the
ESLint guard enforces this); only `env.ts` (and `.config.*` build files like
`drizzle.config.ts`) may read the `APP_ENV` selector.

## Authoring a slice config

A slice owns a `config.ts` (exported under the `./config` subpath) that reads like
its `env.ts`:

```ts
export function xConfig(context: ConfigContext) {
  return createConfig({
    client: { X_PLAN_ID: z.string() },
    profiles: {
      default: { client: { X_PLAN_ID: 'price_dev' } },
      production: { client: { X_PLAN_ID: 'price_live' } },
    },
    context,
  });
}
```

The app composes them: `configExtends([xConfig(context), yConfig(context)])`.

## Consuming config in a feature

A feature never re-resolves `APP_ENV` or builds its own config singleton (that is
the banned module-init global). The app threads the composed `config` in; how a
feature reads it depends on where (ADR 0026, resolved in #94):

- **App edge only** (simplest): the app reads `config.X` and passes it to a
  provider/component it owns — e.g. `<ClerkProvider publishableKey={config...}>`.
  Good when nothing deep in the feature needs the value (`authConfig`).
- **Client-deep:** the slice ships a React provider + hook (see
  `@acme/billing`'s `BillingConfigProvider` / `useBillingConfig`), mounted at the
  app edge with `config`; components/hooks read through the hook. Turn any
  import-time module const into a builder that takes the resolved values.
- **Server-deep:** ride an existing injection point rather than threading a param
  through every call — e.g. `@acme/billing` feeds plan IDs to
  `createSubscriptionsEntitlements(planIds)` (the ADR 0006 entitlements seam) and
  passes the Clerk publishable key to `clerkMiddleware({ publishableKey })`.
