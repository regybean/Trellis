# `@acme/env` — one factory for a slice's config and secrets

A slice declares its whole environment in **one `createEnv` call in one
`env.ts`**. Non-sensitive, per-deploy-target values are authored in code as
profile values; secrets come from `process.env`; and **every** key can be set from
the environment, so one image deploys anywhere. This package supplies the pieces
that make that one call work. See
[ADR 0033](../../../docs/adr/0033-one-env-factory-per-slice.md), which superseded
`@acme/config` ([ADR 0026](../../../docs/adr/0026-config-as-code.md) §§2, 4, 6).

## Ubiquitous language

- **Config** — a key the resolved profile supplies a value for. Static,
  non-sensitive, zod-validated, differs per deploy target (hosts, TTLs, plan ids,
  model selection). Authored in code, identical across all apps in a given
  environment.
- **Secret** — a key the profile supplies **no** value for. That is the whole
  distinction, and it is mechanical rather than editorial: _has a profile value_.
- **Selector** — a `process.env` var that picks a profile/schema/namespace and is
  read pre-composition (module load, `drizzle.config.ts`, a worker, a bundler
  config). Today the set is exactly `{ APP_ENV, NEXT_PUBLIC_WEBAPP }`.
- **`APP_ENV`** — the deploy-target selector: `development | staging | production`.
  Unset → `development` (the base); unknown → throws. Orthogonal to `NODE_ENV`.
- **Profile** — a named layer of values. `default` **is** `development`; `staging`
  and `production` are optional overlays deep-merged over it (arrays replace, not
  concat). A target with no overlay inherits the base, because the environment is
  the authoring surface for a deploy target (ADR 0033 §§2, 4).
- **Unauthoring** — an overlay setting a key to `undefined` removes the base's
  value on that target, so the key becomes a **secret** there. The one way to say
  "config in development, credential in production" (`@acme/ingest`'s LocalStack
  pair, `@acme/billing`'s localstripe placeholders), because every overlay merges
  over the development base.
- **Env-overridable** — **every key**. Every slice lists every key in its
  `runtimeEnv`, so a same-named variable is always read; the profile value is what
  an _unset_ variable resolves to. Structured keys are overridden **whole**, as one
  JSON document. Override is server-side only, because the browser has no
  environment.
- **Development profile module** — `src/development-profile.ts`, the authored
  `default` literal in a module that executes no `createEnv` call. What the
  provisioning paths read (see below).

## Surface

- `withProfiles(shape, appEnv, profiles)` — a `createFinalSchema` implementation
  (t3-env's documented extension point). Attaches each resolved profile value to
  its key's schema with `.prefault()`, so the literal is coerced and validated
  like any other input; relaxes the keys with **no** profile value — the secrets —
  when `shouldSkipEnvValidation()` says this run cannot supply one.
- `secretsOnly(appEnv)` — `withProfiles` with an empty profile, for a call whose
  shape is all secrets (`@acme/auth`'s `CLERK_SECRET_KEY`, `@acme/models`'
  per-provider credential groups). Names why the profile is empty: these keys are
  credentials by construction, not config someone forgot to author.
- `resolveAppEnv(raw)` — turns `process.env.APP_ENV` into a validated `AppEnv`.
- `readEnv(key)` — the `process.env` read a slice's `runtimeEnv` uses; guarded on
  `typeof process` so it returns `undefined` in the browser instead of throwing.
- `jsonEnv(schema)` — wraps a non-string key's schema so it accepts the authored
  literal _or_ a JSON string, and validates both the same way.
- `webappSchema` — the single declaration of `NEXT_PUBLIC_WEBAPP`'s constraint (a
  valid Postgres identifier, because the value names a Postgres schema, the Redis
  namespace and the BullMQ prefix). Six slices declare that key; the constraint
  belongs to the value, not to any one of them.
- `shouldSkipEnvValidation()` — whether the current run (lint step, Next build,
  vitest, CI) can supply secrets at all. Consumed **inside** `withProfiles`;
  `createEnv`'s own `skipValidation` is never passed anywhere.

## Authoring a slice's env

```ts
const appEnv = resolveAppEnv(process.env.APP_ENV);

export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  server: {
    X_HOST: z.string().nonempty(), // profile value -> config
    X_PORT: z.coerce.number().int().positive(), // config, env-overridable
    X_API_KEY: z.string().nonempty(), // no profile value -> secret
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: { X_HOST: 'localhost', X_PORT: 5444 },
      production: { X_HOST: 'x.internal' },
    }),
  runtimeEnv: {
    X_HOST: readEnv('X_HOST'),
    X_PORT: readEnv('X_PORT'),
    X_API_KEY: readEnv('X_API_KEY'),
  },
  emptyStringAsUndefined: true,
});
```

`createFinalSchema` is written as an inline arrow, not a partially applied
`withProfiles`, so `shape`'s type flows in from the sibling
`server`/`client`/`shared` dictionaries. That is what types the profile literals
against each key's `z.input` (a wrong literal is a compile error) and what makes
the returned schema's output the slice's env type.

`runtimeEnv` lists **every** key and is authored as a literal, never `process.env`
itself — `emptyStringAsUndefined` mutates the object it is handed. Reads go
through `readEnv(key)` rather than `process.env.KEY` so they survive the client
bundle (bundlers inline only `NEXT_PUBLIC_*`, `APP_ENV`, `NODE_ENV`; any other
bare `process` reference throws in the browser and kills hydration). The
exceptions are those inlined keys themselves — `NEXT_PUBLIC_WEBAPP`,
`NEXT_PUBLIC_APP_VERSION` and `NODE_ENV` stay longhand, because inlining is
textual substitution and an index access is invisible to it.

A key whose value is **not a string** — an array, an object, a boolean — wraps its
schema in `jsonEnv(...)`, which accepts either the authored literal or a JSON
document (`MODELS_CHAT`, `CREDIT_LIMITS`, `STRIPE_CONNECTION`,
`MEMORY_SEMANTIC_RECALL`).

Slices use `@t3-oss/env-core` with an explicit `clientPrefix`, not
`@t3-oss/env-nextjs`: the Next wrapper's `runtimeEnv` is the _strict_ variant,
which cannot carry an array or object profile value.

### When two slices declare the same key

Slices are isolated, but the environment is one namespace, so two slices can
declare the same variable — and there is exactly **one** value for it per process.
Each slice validates independently, so this is safe when both want the same value
and a hazard when they want different ones.

`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are the live case, and they are
declared with opposite intents:

- `@acme/ingest` authors the LocalStack dummy pair (`'test'`) in development and
  unauthors it on staging/production — S3 config in dev, credential in prod.
- `@acme/models`' `awsSecretEnv()` treats them as pure secrets on every target,
  demanded only when Bedrock is the resolved chat or embed provider.

On staging and production these agree: both are unauthored, so one real credential
pair satisfies S3 and Bedrock alike. **They can only conflict in development, and
only if Bedrock is selected there** — LocalStack accepts any pair, real Bedrock
does not, and one variable cannot be both. The dev default is Ollama
(`MODELS_DEVELOPMENT_PROFILE`), so nothing collides out of the box; a developer who
selects Bedrock locally must supply real credentials, which then also become what
`@acme/ingest` sends to LocalStack (harmless — it authenticates anything).

The keys are deliberately **not** renamed apart. They are the names the AWS SDK's
own provider chain reads, which is the whole reason both slices declare them
rather than threading a value; a prefixed alias would validate a variable the SDK
never looks at. If a future slice needs a genuinely different value for a shared
key, that is the point to give it a distinct name — not to fork the profile.

## `client` vs `shared` vs `server`

t3-env's access guard is **name-based**: a key is server-only if it lacks the
`clientPrefix` and is not in the reading call's `shared` dict.

- `server` — server-only. Reading it in browser code throws.
- `shared` — browser-safe, readable both sides. Where a browser-safe _authored_
  value goes (Clerk's route URLs + publishable key, billing's plan ids, the models
  provider selection), because `client` keys must carry the `NEXT_PUBLIC_` prefix
  — a prefix that would be a lie on a value never read from the environment.
- `client` — actual `NEXT_PUBLIC_*` variables.

Because the guard consults the **reading** call's `shared` dict, a client-side
read goes to the owning slice's env (`@acme/auth/env`), not the app's composed
`env`, which declares no `shared` keys of its own. Where a provider seam already
exists it stays the client's source (`useBillingConfig()`), so the browser sees
the values the server threaded across the RSC/Flight boundary.

## The two bent cases

One call per slice is the rule; two slices split theirs, because something other
than the config/secret line forces a subset to be demandable on its own. Both
still route every call through `withProfiles` (ADR 0033 §6a).

- **`@acme/auth`, by runtime.** Two calls: `clerkWiringEnv()` (the five
  browser-safe authored keys, no secret) and `authEnv()` (which `extends` it and
  adds `CLERK_SECRET_KEY`). `apps/nextjs`'s `middleware.ts` runs in the Edge
  runtime, where `process.env` is a build-time snapshot, so a call that declared
  the secret would demand a value an edge worker cannot have. `<ClerkProvider>`
  reads the same subset.
- **`@acme/models`, by conditional secrets.** Three calls: `env` (the two authored
  provider selections) plus one `secretsOnly` group per provider's credentials,
  demanded by `validateModelSecrets()` only when that provider is the resolved
  choice. A single call would have to mark every provider's credentials
  `.optional()` — the permissive shape this design removes.

## Composition-conditional secret validation

Secrets stay in `process.env`, and **a secret's requiredness is a function of what
the app actually assembles** — never a permissive `.optional()`. Three axes decide
whether a secret's consumer is active:

- **Value axis** — a config value selects _which_ secret is needed within one app
  (`@acme/models`' provider discriminant requiring that provider's key).
- **Composition axis** — whether the app mounts the slice at all. `@acme/auth`'s
  secret is demanded because the full apps compose `authEnv()`; a slim app never
  depends on it ([ADR 0010](../../../docs/adr/0010-slim-no-auth-apps.md)), so it is never
  demanded. Activation is the dependency graph, not an `enabled` flag.
- **Run-context axis** — whether _this run_ can supply a secret at all. A lint
  step, a production build and a non-test CI step cannot; `withProfiles` relaxes
  exactly the keys with no profile value, and nothing else. Config values are
  authored, so they can never be missing and never need relaxing.

The invariant: **no secret is validated permissively; each is validated exactly
when its consumer is active.** Because config and secrets share one call, a slice
cannot ship config with its gated secret unvalidated.

## Provisioning reads the profile, never the env

Three paths **provision** the local stack rather than connect to someone else's,
so they must see the authored values and never an operator's override:
`@acme/db`'s `testing.ts`, `scripts/resolve-compose-env.ts` (whose output
`compose.sh` exports back into the environment — reading an override there would
be circular) and `scripts/resolve-infra.ts`. Each imports a slice's
`src/development-profile.ts`, which is also what that slice's `env.ts` authors its
`default` from. Deriving rather than restating is the property that matters.

Consequence worth stating plainly: overriding `DB_NAME` points a _connection_ at a
different database; it does not rename the one compose provisions.
