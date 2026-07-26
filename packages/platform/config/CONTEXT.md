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
