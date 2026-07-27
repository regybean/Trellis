# `@acme/config` — config-as-code

Non-sensitive, per-deploy-target tunable values live in code here, not in
`process.env`. `process.env` is reserved for **secrets + selectors**; config is
the values a selector picks. See [ADR 0026](../../../docs/adr/0026-config-as-code.md).

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
- **Context** — the injected `{ appEnv, isServer }` a slice's config factory
  receives. Config is **pure**: it never reads `process.env`/`NODE_ENV` — the app
  resolves the context once at its edge and threads it in.

## Surface

- `createConfig({ server, client, profiles, context })` — merge the `APP_ENV`
  profile over `default`, validate through the zod shapes (coercion runs on the
  merge), return a guarded object. Reading a `server` key on the client throws.
- `configExtends([...])` — compose several slice configs into one flat object at
  the app edge, mirroring `env.ts`'s `extends: [...]`.
- `resolveAppEnv(raw)` — the app's edge turns `process.env.APP_ENV` into a
  validated `AppEnv`.
- `ConfigValidationError` — wraps the `ZodError`; message is `z.prettifyError`.

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
