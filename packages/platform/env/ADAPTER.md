# Mounting `@acme/env`

The toolkit every other package's `env.ts` is built from, and that your app's
env composition uses. You mount it by writing that composition
([env.md](../../../docs/mounting/env.md)).

## What it gives you

- `withProfiles` — layers per-deploy-target defaults onto an env schema through
  a documented extension point, so no key needs a hand-written default and
  nothing is forked or patched.
- `secretsOnly` — `withProfiles` with an empty profile, for a call whose shape is
  all secrets. Use it to say the emptiness is deliberate: these keys are
  credentials by construction, not config someone forgot to author.
- `resolveAppEnv` — resolves the deploy-target selector. Each package resolves
  the same selector at its own edge, so profiles agree without a context object
  being threaded anywhere.
- `readEnv` — reads a key so that a profile value and an environment-variable
  override both work, which is what makes every config key overridable.
- `webappSchema` — the validator for your app's identity key, which becomes its
  Postgres schema and Redis namespace.
- `jsonEnv` — parses a structured value out of a single environment variable,
  for config that is a shape rather than a scalar.
- `shouldSkipEnvValidation` — whether the current run (lint step, Next build,
  vitest, CI) can supply secrets at all. `withProfiles` already consults it, so
  you need it only if you construct something whose own guards run at import and
  must be handed a stand-in on those runs.

## Surface

| Import      | What's in it                                | Runs   |
| ----------- | ------------------------------------------- | ------ |
| `@acme/env` | The profile, selector and read-time helpers | either |

## Wiring

- Write your app's env composition and compose each mounted package's factory
  into its `extends` list — [env.md](../../../docs/mounting/env.md).
- Resolve the deploy-target selector once in that file and make sure your
  bundler inlines it, or client-side code resolves a different profile than the
  server does.
- Run your composed env at boot so a missing secret fails at startup rather than
  at the first request that reads it
  ([ADR 0001](docs/adr/0001-one-env-factory-per-slice.md) §3).
- Read `process.env` nowhere else. This package exists so that the composition
  is the single edge, and a scattered read bypasses validation, coercion and
  profiles at once.
