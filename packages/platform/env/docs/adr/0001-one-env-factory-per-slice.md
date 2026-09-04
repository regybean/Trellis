# One env factory per slice — profiles ride `createFinalSchema`, every key is overridable

**Status:** accepted

> `@acme/config` and its ADR are gone; this ADR is the whole record. The
> mechanism that ADR described — a second `createConfig` call, the purity seam,
> the arg-injection of `{ appEnv, isServer }` — is replaced by §§1–3 below. What
> it got right and this keeps: the classification of which values are secrets,
> restated here as the mechanical "has a profile value" rule; the closed
> `{development, staging, production}` profile set with `development` as the
> base; the `APP_ENV` resolution rule; and the guarantee that config always
> validates.

## Context

`@acme/config` and `@acme/env` were two zod-based validators sitting side by
side. A slice that owned both wrote a `config.ts` and an `env.ts` with different
authoring styles (`{ server, client, profiles, context }` vs
`{ server, client, runtimeEnv, skipValidation }`), different error types
(`ConfigValidationError` vs t3-env's handler), different skip semantics (config
always validates; env skips on lint/build/CI) and different access guards (a
membership-based Proxy vs a name-based one). Both mechanisms existed to answer
the same question — _what values does this slice need, and are they valid?_ — and
a reader had to hold both in their head. Composing an app meant composing two
lists: `extends: [chatEnv(), …]` in `env.ts` and a parallel
`configExtends([authConfig(ctx), …])` in `config.ts`.

The second pressure is deployment. `@acme/config` had moved non-sensitive
tunables into code, which was right about _authorship_ and made every value
**baked**: retuning one for a single deploy meant editing a profile,
committing and rebuilding an image. Two slices had already hand-rolled a way out
(`process.env.DB_HOST ?? config.DB_HOST`, `Number(process.env.DB_PORT)`,
`process.env.REDIS_URL ?? config.REDIS_URL`) — bypassing validation, coercing by
hand, and covering only the keys someone remembered to wire.

## Decision

**`@acme/config` is deleted. Every slice declares its whole environment in one
`createEnv` call in one `env.ts`, and every key in that call is overridable by an
environment variable of the same name.**

### 1. One call, one file, and the config/secret line is mechanical

Within a slice's single `createEnv` call:

- **a key the resolved profile supplies a value for is config**;
- **a key it doesn't is a secret**.

That is the whole distinction. It is mechanical, not editorial — no second list
to keep in sync, no judgement call at authoring time.
Which values count as secrets is unchanged from the config-as-code split that
preceded this; what changes is that the classification is readable off the file
rather than off which file a key lives in.

A two-file variant (`config.ts` for defaults, `env.ts` for secrets) was
considered for legibility and rejected: it reproduces at file level the split
being removed.

### 2. Profiles attach via `createFinalSchema`

`APP_ENV` profile layering rides t3-env's documented `createFinalSchema`
extension point. No fork, no patch, no per-key hand-written `.default(...)`:

```ts
const appEnv = resolveAppEnv(process.env.APP_ENV);

export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  server: {
    DB_HOST: z.string().nonempty(),
    DB_PORT: z.coerce.number().int().positive(),
    DB_PASSWORD: z.string().nonempty(), // no profile value -> secret
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: { DB_HOST: 'localhost', DB_PORT: 5444 },
      production: { DB_HOST: 'db.internal' },
    }),
  runtimeEnv: {
    DB_HOST: readEnv('DB_HOST'),
    DB_PORT: readEnv('DB_PORT'),
    DB_PASSWORD: readEnv('DB_PASSWORD'),
  },
  emptyStringAsUndefined: true,
});
```

`withProfiles(shape, appEnv, profiles)` returns a `StandardSchemaV1` that:

1. resolves the `APP_ENV` overlay over `default` — deep-merge, arrays replace
   (an overlay that sets a list means “use this list”, not “append to the
   base's”), via `ts-deepmerge`;
2. attaches each resolved value to its key's schema with **`.prefault(value)`**,
   so the literal is fed _through_ the schema and is coerced and validated like
   any other input. `.default()` would short-circuit parsing and let an invalid
   profile literal through, breaking the always-validate guarantee for the values
   that matter most;
3. relaxes the keys with **no** resolved value — the secrets — to optional when
   `shouldSkipEnvValidation()` is true.

Defaults live in the **schema**, not in `runtimeEnv`. That is forced, not
stylistic: `runtimeEnv` carries strings, so an object or array value
(`MODELS_CHAT`, `CREDIT_LIMITS`, `STRIPE_CONNECTION`) cannot ride it.

`createFinalSchema` is written as an inline arrow rather than a partially applied
`withProfiles`, so `shape`'s type flows in from the sibling
`server`/`client`/`shared` dictionaries. That is what gives **authoring-time
safety**: profile literals are typed against each
key's `z.input`, so a wrong literal is a compile error reported on the literal.

**The profile set is closed, and inheritance is deliberate.** `APP_ENV` selects
one of `development` / `staging` / `production`; `default` _is_ development, and
`staging`/`production` are optional overlays merged over it. Unset or empty
resolves to `development`, which keeps local and test runs ergonomic; an unknown
value **throws**, because a typo like `prod` silently degrading would bake the
wrong config into an image. Each slice resolves the selector at its own
sanctioned `process.env` edge, so the profiles agree without threading a context
object. A target that authors no overlay
inherits the base rather than throwing, because §4 makes the environment the
authoring surface for a deploy target: a slice does not have to be re-authored to
be deployable, and an overlay is for values that belong in version control.

### 3. `skipValidation` is never passed, anywhere

`createEnv({ skipValidation: true })` returns `runtimeEnv` **raw**, before any
schema runs — discarding defaults, coercion and the client-access guard together.
In a single call holding both config and secrets that would silently drop every
config default: `env.DB_HOST === undefined` at lint time, where `dbConfig` gave
`'localhost'`.

So the skip moves from per-call to **per-key**, inside `withProfiles`. Config
values are authored, so they can never be missing and never need skipping; the
only thing a lint/build/CI run cannot supply is a secret, and that is the only
thing relaxed. This is not a new permission — it is the pre-existing env-validation skip, made
precise, and it adds a **run-context axis** to the two existing axes of secret
requiredness (value, composition). Config always validates, unchanged.

The skip predicate itself is one policy this package owns —
`shouldSkipEnvValidation()`, never a copy in each slice's `env.ts`:

- `npm_lifecycle_event === 'lint'` — the step has no env and needs none;
- `IS_NEXT_BUILD` — exported by the build scripts and declared in `turbo.json`
  `globalEnv`, so it is set early enough to actually fire;
- `NEXT_PHASE === 'phase-production-build'` — the non-build Next phases.
  `NEXT_PHASE` alone is not enough: `next.config.js` jiti-imports `env` _before_
  Next sets it, which is why `IS_NEXT_BUILD` comes first;
- `VITEST` → **never skip**. Vitest sets it in every worker, so a test run
  validates and coerces even under `CI`
  ([ADR 0014](../../../../../docs/adr/0014-tests-validate-real-env.md));
- otherwise, `CI`.

The `VITEST` carve-out is load-bearing rather than cosmetic. Without it a backend
suite under `CI` validated nothing, and `EMBED_DIMENSIONS` reached
`pgVector.createIndex()` as the string `'768'` — never coerced, so the index build
rejected it and `mastra_documents` was never created. The cost is that every
required key must exist in `staticTestEnv` (`tooling/test-utils`): a missing one
now fails loudly instead of being skipped.

It also closes a live trapdoor at the app edge: each app passed
`extends: [chatEnv(), …]` with `runtimeEnv: {}` and `skipValidation`, and because
`createEnv` returns `runtimeEnv` _before_ merging `extends`, the composed `env`
was literally `{}` on every skip path.

### 4. Every key is env-overridable

**A key is env-overridable iff it appears in the call's `runtimeEnv`** — and
every key appears. Profile values ride the schema, so an unset variable still
resolves to the authored value; what changes is that a variable with the right
name is always read. Precedence, override last:

```
default profile → APP_ENV overlay → environment → validate
```

An opt-in list was considered and rejected. The list is a prediction about which
values will need to change, and it is wrong at exactly the moment it matters —
every entry on the two hand-rolled ones was added retroactively, after someone
hit the wall. What an operator gets when the prediction is wrong is not an error
but a variable that is set, spelled correctly, and silently ignored.

Two helpers make it cheap, so this is not 25 hand-rolled workarounds:

- **`readEnv(key)`** is the `process.env` read that survives the client bundle. It
  guards on `typeof process` — a bundler inlines only `NEXT_PUBLIC_*`, `APP_ENV`
  and `NODE_ENV`, so any other `process.env.X` reaches the browser as a bare
  `process` reference and throws while the env module is still evaluating, which
  kills hydration. Slices that build their env in the browser (any slice with a
  `shared` key) make this load-bearing, not defensive. The statically inlined keys
  — `NEXT_PUBLIC_WEBAPP`, `NEXT_PUBLIC_APP_VERSION`, `NODE_ENV` — stay written
  longhand, because inlining is textual substitution and an index access is
  invisible to it. `read-env.ts` joins `env.ts` in the ESLint `process.env`
  guard's ignore list: same sanctioned edge, factored out so the browser-safety
  guard lives in one place.
- **`jsonEnv(schema)`** accepts either the authored literal or a JSON string and
  validates both against the same schema. An environment variable is a string;
  `z.coerce.number()` covers scalars, but an array, an object or a boolean has no
  such coercion, so `MODELS_CHAT` would otherwise be overridable in name only. It
  is a union rather than a `z.preprocess` so the input type stays
  `string | z.input<TSchema>` and §2's authoring-time safety survives. Booleans go
  through it rather than `z.coerce.boolean()`, which makes every non-empty string
  `true` — an operator disabling something would have enabled it.

Structured keys are overridden **whole** (`STRIPE_CONNECTION`, not
`STRIPE_CONNECTION__apiBase`): the discriminated union exists so a
half-configured value cannot be represented, and per-field override would hand
that failure back. There is therefore no `__` path grammar, no build-time client
override snapshot, and no lint script — "every key" needs no policing.

**Override is server-side only.** A browser has no environment: `readEnv` returns
`undefined` there and the authored profile applies, which is exactly what
config-as-code did before overrides existed.

### 5. Slices use `@t3-oss/env-core` with an explicit `clientPrefix`

`@t3-oss/env-nextjs`'s `runtimeEnv` is the **strict** variant — every server,
client and shared key, typed `string | boolean | number | undefined`. That cannot
carry an array or object profile value. `env-core` with
`clientPrefix: 'NEXT_PUBLIC_'` is otherwise identical (that is all the Next
wrapper adds), so slices call it directly. The `@t3-oss/env-nextjs` catalog entry
is removed.

### 6. `client` vs `shared` vs `server`, and who reads what

t3-env's access guard is **name-based**, not membership-based: a key is
server-only if it lacks the `clientPrefix` and is not in the reading call's
`shared` dict. That is coarser than `createConfig`'s Proxy — it also throws on
typos and on keys in no schema at all. **Accepted cost.**

- `server` — server-only. Reading it in browser code throws.
- `shared` — browser-safe, readable both sides. This is where a browser-safe
  _authored_ value goes (Clerk's route URLs and publishable key, billing's plan
  ids and portal URL, the models provider selection), because `client` keys must
  carry the `NEXT_PUBLIC_` prefix — a prefix that would be a lie on a value that
  is never read from the environment.
- `client` — actual `NEXT_PUBLIC_*` variables.

Because the guard consults the **reading** call's `shared` dict, a client-side
read goes to the owning slice's env (`@acme/auth/env`, `@acme/billing/env`), not
the app's composed `env`, which declares no `shared` keys of its own. Where a
provider seam already exists it stays the client's source — `ConsoleShell` reads
the billing-portal URL through `useBillingConfig()`, so the browser sees the
values the server threaded across the RSC/Flight boundary.

**Provisioning is the one thing that must not see an override.** Three paths
provision the local stack rather than connect to someone else's:
`@acme/db`'s `testing.ts` (the testcontainer descriptor),
`scripts/resolve-compose-env.ts` (the compose stack, whose output `compose.sh`
exports back into the environment — reading an override there would be circular)
and `scripts/resolve-infra.ts` (which compose profiles to start). Each reads a
slice's `src/development-profile.ts` — the same literal `env.ts` authors its
`default` from — so they see the authored values and never an operator's. Those
modules execute no `createEnv` call, so a provisioning script does not have to
satisfy every slice's selectors just to read a port. Overriding `DB_NAME`
therefore points a _connection_ at a different database; it does not rename the
one compose provisions.

### 6a. The two bent cases: `@acme/auth` and `@acme/models`

One call per slice is the rule; two slices split their call, and in both the
reason is that **something other than the config/secret line** forces a subset to
be demandable on its own. Neither is a second config mechanism — every call still
routes through `withProfiles`, and `skipValidation` is still never passed.

**`@acme/auth` — split by runtime.** `clerkWiringEnv()` carries the five
browser-safe authored keys and no secret; `authEnv()` `extends` it and adds
`CLERK_SECRET_KEY`, and is what the full apps compose. `apps/nextjs`'s
`middleware.ts` runs in the Edge runtime and needs only the publishable key; a
call that also declared the secret would demand it from a `process.env` that is a
build-time snapshot there, so a correctly configured deploy would 500 on every
request (the same hazard the pre-existing "resolve just the auth slice here, NOT
`~/env`" comment guarded against). `<ClerkProvider>` in both apps reads the same
subset, which is also what keeps an isomorphic route from touching a server key.

**`@acme/models` — split by conditional secrets.** Three calls: `env` holds the
two authored provider selections (`MODELS_CHAT`, `MODELS_EMBED`), and
`awsSecretEnv()` / `openrouterSecretEnv()` each hold one provider's credentials.
Which secrets are required is a **function of the resolved selection** — Bedrock
needs the AWS creds, OpenRouter needs its API key, Ollama needs nothing — and a
single call cannot express that: it would have to mark every provider's
credentials `.optional()`, which is precisely the permissive shape this ADR
removes. So the groups are separate calls, demanded conditionally by
`validateModelSecrets()`, and each uses `secretsOnly(appEnv)` — no authored
values, so every key in them is a secret by construction. The selection axis
(what to use) stays one call; the value axis (which credentials that implies) is
resolved from it.

### 7. `@acme/config` dissolves into `@acme/env`

Two packages for one mechanism would reproduce at package level the confusion
being removed at slice level. `withProfiles`, `secretsOnly`, `resolveAppEnv`,
`appEnvSchema`, `APP_ENVS`, `AppEnv`, `readEnv`, `jsonEnv` and `webappSchema` live
in `@acme/env`. The last three are there because they are the shapes every slice
would otherwise repeat: `readEnv` is the one guarded `process.env` read, `jsonEnv`
the one non-string override channel, and `webappSchema` the single declaration of
`NEXT_PUBLIC_WEBAPP`'s Postgres-identifier constraint (six slices declare that
key). `secretsOnly(appEnv)` is `withProfiles` with an empty profile — the
secrets-gate calls in §6a.

Deleted: `createConfig`, `configExtends`, `describeConfig`,
`ConfigValidationError`, the client-guard Proxy, the `ConfigContext` /
`serverConfigContext` / `appConfigContext` injection seam, the `coercedBoolean`
helper (`jsonEnv` covers it), the `./config` export role in
`scripts/check-exports.mjs`, and every slice's `config.ts`. The app's second
composition edge goes with it: `configExtends([...])` in each app's `src/config.ts`
collapses into the single `extends: [...]` list in `env.ts`.

The **purity seam** is gone. `createConfig` never read `process.env`; the app
resolved `{ appEnv, isServer }` once and threaded it in. A single
`createEnv` call cannot be pure — it reads `runtimeEnv` — so each slice resolves
`APP_ENV` at its own `env.ts` edge, the file the ESLint guard already exempts.

## Consequences

- **A slice can no longer ship config with its gated secret unvalidated.** They
  are the same call. (The failure this guards against: `authConfig` once shipped
  with no secret validation at all.)
- **Local development needs fewer `.env` rows, and the credentials it does need
  are authored honestly.** `@acme/ingest` authors LocalStack's dummy AWS pair and
  `@acme/billing` authors localstripe's fixed placeholders (documented as not real
  secrets, gitleaks-allowlisted, [@acme/billing ADR 0001](../../../../features/billing/docs/adr/0001-localstripe-dev-billing.md)) in
  their **development** profiles, and both **unauthor** them in the
  staging/production overlays — so a real target must supply them, by the same
  mechanical rule as every other secret. `@acme/db`'s `DB_PASSWORD` authors
  nothing on any target and keeps coming from `deploy/.env` locally: it is the one
  credential whose container we provision _and_ whose value a real deploy must
  never inherit by accident.
- **A production deploy is configured by environment, not by a commit.** Any
  value — a TTL, a bucket, a collector endpoint, a whole Stripe connection — is
  reachable from the environment of the container that runs. That is the property
  that makes the same image deployable anywhere.
- **Three things are now reachable that were pinned.** The Stripe plan
  ids/publishable keys, the Clerk publishable key, and the models provider
  selection each keep their profile value, so an unset environment resolves to the
  authored target; being reachable is not being expected. The doc comment on the
  key is the control, not the absence of the row.
- **One documented type assertion**, in `withProfiles`: the final schema is
  composed from a `Record<string, z.ZodType>`, so its static output is
  `Record<string, unknown>` and the precise shape is knowable only from the
  caller's `TShape`. It is also where the skip path's one honest divergence lives —
  a relaxed secret absent from the environment is absent from the parsed value
  while the type says it is present. That is exactly what `skipValidation: true`
  did; the alternative (`string | undefined` on every secret) would push the skip
  path's shape onto every real caller.
- **Validation errors keep naming every failing key** (`z.prettifyError` in
  `withProfiles`), which is what `ConfigValidationError` gave.
- **`turbo.json`'s `globalEnv` shrinks back to selectors, secrets and build/dev
  signals.** Server-side override happens at runtime, so it cannot change a build
  output; only the bundler-inlined keys (`NEXT_PUBLIC_*`, `APP_ENV`) affect the
  cache, and they were already listed.
- **`@acme/models`' schemas moved to `src/model-schemas.ts`**, keeping the two
  discriminated unions and the six variant types out of the lint-exempt `env.ts`.
  It is data and schemas, not a second validation mechanism.

## Rejected alternatives

- **An override layer bolted onto `createConfig`** (the first attempt at this
  branch): `ConfigContext.overrides`, a `__` path grammar for nested values, a
  build-time client-override snapshot inlined by each bundler
  (`ACME_CONFIG_CLIENT_OVERRIDES`), and a ~250-line lint script enforcing
  coercion-tolerant leaves and override-name collisions. It delivered
  overridability while _deepening_ the two-mechanism split it had to live inside,
  and most of its cost was the price of keeping `createConfig` pure. Folding the
  two factories into one deletes the layer and its lint script outright.
- **Folding inward** — having `createConfig` absorb secrets and dropping
  `@t3-oss/env` from the tree. It would have preserved profile layering, the
  membership-based guard and the purity seam, at the cost of owning
  `clientPrefix` enforcement and abandoning a maintained upstream. Rejected on
  preference for the maintained library.
- **Requiring every non-development target to author an overlay** (fail loud
  rather than inherit the development base). Right when the environment is not an
  authoring surface; wrong here, because §4 makes it one — and a starter repo
  whose deploy targets are unknown would ship profiles nobody can fill in.
- **Dynamic/remote runtime config** — rejected when config-as-code was designed,
  and still rejected.
