# Config values are env-overridable by same-name key

**Status:** accepted.

## Context

[ADR 0026](0026-config-as-code.md) moved non-sensitive tunables out of
`process.env` into code. A slice authors a `config.ts`, and `createConfig`
resolves `default` profile, then the `APP_ENV` overlay, then validates. That was
the right split of _authorship_, because those values belong in version control
rather than a credential store. It also made every value **baked**: retuning one
for a single deploy means editing a profile, committing, and rebuilding the image.

Two slices had already hit that wall and hand-rolled a way out.

```ts
// @acme/db env.ts
DB_HOST: process.env.DB_HOST ?? config.DB_HOST,
DB_PORT: process.env.DB_PORT ? Number(process.env.DB_PORT) : config.DB_PORT,

// @acme/redis env.ts
REDIS_URL: process.env.REDIS_URL ?? config.REDIS_URL,
```

Both for the same reason. A testcontainer hands back a _dynamic_ mapped port and
a production endpoint is _infra-injected_, so static config cannot know either.
That pattern is the seed this ADR generalises, and as written it had three
problems.

It covered only the three keys someone remembered to wire. `S3_ENDPOINT`, an OTLP
collector endpoint, a credit limit, and a queue retention count all wanted the
same thing and did not get it. It bypassed validation, because the raw string went
straight into `env`, so `Number(process.env.DB_PORT)` could yield `NaN` and
`REDIS_URL` was never re-checked as a URL. And each site coerced by hand,
differently.

## Decision

**Any non-sensitive config value is overridable by an environment variable of the
same name.** Precedence, override last:

```
default profile → APP_ENV overlay → env override → validate
```

### 1. The override bag rides the existing purity seam

`ConfigContext` gains an `overrides` map. `config.ts` still never reads
`process.env`. The bag is sampled at the sanctioned `env.ts` edge and threaded in
exactly as `appEnv` already is (ADR 0026 §4), so the ESLint purity guard on config
modules stays fully armed and tests still construct a context as a literal.

Two helpers do the sampling, so no edge can forget the bag.

- `serverConfigContext(process.env)` for a slice's own server edge (`env.ts`,
  `register.ts`, a script).
- `appConfigContext({ appEnv, clientOverrides, serverEnv })` for an app's
  `env.ts`, which the browser bundle also reaches and so needs both lanes.

`createConfig` keeps only the entries whose first `__`-segment names a key that
shape declares, so the whole of `process.env` can be handed over and nothing
foreign is picked up. Unset and empty values are skipped and fall through to the
profile.

### 2. Everything is overridable, including nested shapes

- **Scalars** by bare same-name key: `DB_PORT=6543`.
- **Nested objects, discriminated unions, records and arrays** by a `__`-joined
  path down to a scalar leaf: `stripe__apiBase`, `CREDIT_LIMITS__Pro`,
  `replicas__1__weight`.
- **A union flips** by setting the discriminant plus the target variant's required
  fields, as in `store__mode=remote store__region=eu-west-2`. Zod strips the prior
  variant's residue at parse time. This is the same object-strip that already lets
  a `production` overlay flip `modelsConfig`'s provider.

Coercion is **config-owned**, so there is no second env schema. A leaf must accept
the string an environment hands over, which means `z.coerce.number()` rather than
`z.number()`, and `coercedBoolean()` (`boolean | z.stringbool()`) rather than
`z.boolean()`. Deliberately not `z.coerce.boolean()`, whose JavaScript truthiness
reads `'false'` as `true`. Validation runs **after** the merge, so an override is
coerced and checked like any profile value. A bad port now fails at boot with a
`ConfigValidationError` instead of becoming `NaN`.

### 3. Server samples at runtime, client is frozen at build

The two lanes are separate bags, not one.

- **Server** keys are sampled from `process.env` at **runtime**. This is the
  genuine build-once-deploy-anywhere case. Set the variable, restart.
- **Client** keys are inlined by the bundler and frozen in the image. Their
  override cannot be read from a deployed environment; it has to be set at
  **build** time.

Each app's bundler config derives its client-overridable leaf names from the
composed config, never a hand-kept list, picks up whichever are set in the build
environment, and injects them into `next.config.js`'s `env` map or
`vite.config.ts`'s `define` map. One entry per leaf, plus the whole lane as one
frozen `ACME_CONFIG_CLIENT_OVERRIDES` JSON literal. The literal is what the app's
`env.ts` reads back, because neither bundler lets browser code enumerate
`process.env`; both rewrite individual member expressions. Every leaf name is also
registered in `turbo.json` `globalEnv`, so a changed client override busts the
build cache instead of replaying a stale bundle.

Keeping the lanes separate is what makes this limit structural rather than
documented. With one flat bag, a runtime variable would override a client key
during server rendering while the browser held the frozen value, which is a
hydration mismatch by construction.

### 4. The one divergence: profiles replace arrays, overrides patch them

A profile overlay that sets an array **replaces** it wholesale
(`mergeArrays: false`, ADR 0026 §2, "use this list", not "append to it"). An
override of `KEY__1__field` **patches element 1 in place** and leaves its siblings
alone.

Two array semantics in one system is a real cost, and index addressing makes it
unavoidable. `KEY__1__field` has no way to say "and drop the rest". Making
overrides replace instead would mean re-specifying an entire list to change one
field of one element, which is the work this mechanism exists to avoid. So it is
documented rather than reconciled.

### 5. Secrets are still not config, and now it is enforced

The override layer does not move secrets into config. A secret in a config key
would be inlined into the client bundle, if client, and committed to the profile,
always. That is the whole reason ADR 0026 §1 kept them in `process.env`.
`DB_PASSWORD` stays exactly where [ADR 0016](0016-db-connection-platform-package.md)
put it, a `createEnv` secret with the skip-validation stub for lint and build, and
its behaviour is unchanged.

What used to be a judgement call is now a lint failure. `pnpm lint` runs
`scripts/check-config-overrides.ts`, which discovers every slice `config.ts`
rather than keeping a list, so a new slice is covered the moment it exists. It
hard-fails on:

1. **Collision.** A config key that shadows a key validated in any `env.ts`, or
   one of the `{ APP_ENV, NEXT_PUBLIC_WEBAPP }` selectors. One variable cannot be
   both a secret slot and an overridable value.
2. **Intolerant leaf.** An overridable scalar whose schema rejects a string, so a
   same-name variable could never set it. The key would _look_ overridable.
3. **Literal `__`** in a key name, which makes `KEY__field` ambiguous between a
   nested path and a top-level name.

It also fails when a client-overridable leaf is missing from `turbo.json`
`globalEnv`.

## Consequences

- **Supersedes ADR 0026 §1's decoupling claim.** That section drew a clean line:
  a value is _either_ a `process.env` secret or selector, _or_ config-as-code, and
  never both. That line is now redrawn. `process.env` remains the sole home of
  secrets and selectors, but it is also an **override channel** for config. What
  survives intact is the direction of authority. Config's source of truth is code,
  and env can only retune a value that a profile already authored and a schema
  already validates. An env variable can never introduce a config key.
- **The `??` lines are gone.** `@acme/db` and `@acme/redis` read straight off
  their config. `DB_HOST`, `DB_PORT` and `REDIS_URL` are ordinary overridable keys
  and are now validated on the override path, which they were not before.
  `S3_ENDPOINT` and every other tunable gained the same capability for free.
- **`env.ts` is now the only config edge.** Each slice exports one `configContext`
  and every call site threads it, replacing about 25 hand-written
  `{ appEnv, isServer: true }` literals. That is what makes forgetting the
  override bag impossible, and forgetting it is a silent failure no test could
  have caught.
- **Accepted: `process.env` can now perturb any config value.** A mistyped
  variable name is silently ignored, because it matches no declared key, and a
  mistyped value fails loudly at boot. Failing loudly on bad values is the
  tradeoff we want. Ignoring unknown names is forced, since the bag is the whole
  environment.
- **Accepted: coercion-tolerance is a constraint on config authors.** Every
  numeric and boolean leaf in the repo changed shape. The gate makes that
  self-enforcing instead of folklore.
- **Client overrides need a rebuild.** Operators get build-once-deploy-anywhere
  for server config only. That asymmetry is inherent to bundling rather than a gap
  to close later, and `@acme/config`'s `CONTEXT.md` documents it next to the
  syntax.
