# A secret's requiredness is derived, never declared — three axes, no `.optional()`

**Status:** accepted

## Context

[ADR 0001](0001-one-env-factory-per-slice.md) settled _where_ a secret is
declared: in the slice's one `createEnv` call, as a key with no profile value. It
did not settle _when_ that key is demanded, and it could not — §3 added the
run-context axis while treating the other two as pre-existing background,
inherited from the config-as-code split whose ADR was deleted. So the rule that
actually governs every `.optional()` decision in the repo was recorded nowhere.

The pressure is that a secret is not always needed. `OPENROUTER_API_KEY` matters
only if OpenRouter is the selected chat provider. `BETTER_AUTH_SECRET` matters
only to an app that mounts auth at all — the `*-slim` apps
([ADR 0010](../../../../../docs/adr/0010-slim-no-auth-apps.md)) never do. A lint
step can supply none of them. The obvious accommodation is
`z.string().optional()`, and it is the wrong one: it makes a genuinely missing
credential a runtime failure at the first request that needs it, on every target,
forever — in exchange for making one build step quiet.

## Decision

**A secret's requiredness is a function of what the app actually assembles and of
what this run can supply. It is never softened with `.optional()`.** Three axes
decide whether a secret's consumer is active:

- **Value axis** — a config value selects _which_ secret is needed within one app.
  `@acme/models`' provider discriminant requires that provider's credentials and
  no others; `validateModelSecrets()` reads the resolved selection and runs only
  the matching group's call (0001 §6a).
- **Composition axis** — whether the app mounts the slice at all. `@acme/auth`'s
  secret is demanded because the full apps compose `betterAuthEnv()`; a slim app
  never depends on it, so it is never demanded. **Activation is the dependency
  graph, not an `enabled` flag** — there is nothing to set, and nothing that can
  disagree with what the app imports.
- **Run-context axis** — whether _this run_ can supply a secret at all. A lint
  step, a production build and a non-test CI step cannot. `withProfiles` relaxes
  exactly the keys with no profile value, and nothing else (0001 §3). Config
  values are authored, so they can never be missing and never need relaxing.

The invariant: **no secret is validated permissively; each is validated exactly
when its consumer is active.**

Each axis resolves at a different time — the composition axis at module graph
construction, the value axis after the config parse, the run-context axis from
the process's own environment — which is why none of them can collapse into
another's mechanism.

## Consequences

- **A slice cannot ship config with its gated secret unvalidated,** because config
  and secrets share one call. The failure this guards against is real: the
  pre-Better-Auth `authConfig` once shipped with no secret validation at all.
- **Adding a provider means adding a group, not an `.optional()` key.** The cost
  of a new conditional secret is one `secretsOnly` call plus a branch in the
  slice's validation entry point — deliberately more than adding `.optional()`,
  and the reason the permissive shape does not creep back.
- **A slim app's `.env.example` is honestly shorter.** Not because rows were
  marked optional, but because the app does not import the slice that declares
  them.
- **A build stub must be a legal value, not a placeholder.** Since the
  run-context axis relaxes rather than skips, the infrastructure-client stubs a
  CI build still needs are parsed and coerced like any other input.

## Rejected alternatives

- **`.optional()` on conditionally-needed secrets.** Turns a configuration error
  into a request-time error on every target, to quiet one build step. It is the
  shape all three axes exist to avoid.
- **An `enabled` / feature-flag boolean per slice.** A second source of truth for
  something the dependency graph already states, and one that can contradict it:
  an app can import a slice with its flag off, or set the flag with nothing
  mounted.
- **One optional "secrets" bag validated by hand at boot.** Restores a second
  validation mechanism beside `createEnv` and loses per-key error messages, which
  is the split ADR 0001 removed.
