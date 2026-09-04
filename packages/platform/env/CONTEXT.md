# Platform Env (`@acme/env`)

A slice declares its whole environment in **one `createEnv` call in one
`env.ts`**. Non-sensitive, per-deploy-target values are authored in code as
profile values; secrets come from `process.env`; and **every** key can be set from
the environment, so one image deploys anywhere. This package supplies the pieces
that make that one call work.

## Language

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
  the authoring surface for a deploy target.
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
  provisioning paths import instead of a resolved env.

## Relationships

- **Nothing in the repo sits below this package.** It depends on no other
  `@acme/*` package — only `@t3-oss/env-core`, `zod` and `ts-deepmerge` — because
  every slice's `env.ts` and every app's env composition import it. A dependency
  on a slice would be a cycle through that slice's own env.
- **Every slice's `env.ts` is a consumer, and so is `@acme/db` at read time.**
  Slices use `withProfiles` / `secretsOnly` / `readEnv` / `jsonEnv` to build their
  call; `@acme/db` additionally calls `shouldSkipEnvValidation()` directly, to
  decide whether to hand its infrastructure clients a stub value.
- **The provisioning paths bypass this package entirely.** `@acme/db`'s
  `testing.ts`, `scripts/resolve-compose-env.ts` and `scripts/resolve-infra.ts`
  import a slice's **development profile module** rather than its env, so they
  never execute a `createEnv` call and never have to satisfy a selector to read a
  port.
- **`webappSchema` is shared because the value is.** Six slices declare
  `NEXT_PUBLIC_WEBAPP`; the Postgres-identifier constraint belongs to the value,
  not to whichever slice declares it first.
- **`tooling/test-utils`' `staticTestEnv` is coupled to every slice's required
  keys.** Test runs validate rather than skip, so a required key missing from
  `staticTestEnv` fails the suite loudly.
- **The ESLint `process.env` guard exempts exactly two files here** — `env.ts` and
  `read-env.ts` — which is what makes this package the one sanctioned read edge.

## Decisions

See [`docs/adr/`](docs/adr/).
