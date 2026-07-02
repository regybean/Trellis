# Test Utils (`@acme/test-utils`)

Shared testing substrate: the testcontainer lifecycle and the env plumbing that
lets suites validate real `env.ts` instead of mocking it (ADR 0014). It owns
_how_ tests get a running DB/Redis and a populated `process.env` — not _what_
any feature asserts.

This package is **infra-only**. The tRPC caller context + mocks live in
`@acme/trpc/testing`, and the Redis flush helper in `@acme/redis/testing` —
owned by the packages whose real types they need, since this tooling package
sits below `platform` and cannot import those types. `@acme/test-utils` no longer
ships a `./mocks` entrypoint.

## Language

**`staticTestEnv`** (`@acme/test-utils/vitest`):
The single source of static, non-secret env spread into every suite's `test.env`
(backend and frontend). Values only need to satisfy each package's `env.ts`
schema — they never reach a real service. New static test vars go here, not into
a per-suite mock.
_Avoid_: "the env defaults", "the fake env"

**Env hydration** (`@acme/test-utils/hydrate-env`):
A backend setupFile that copies the testcontainer connection details published by
`global-setup` (`inject(...)`) into `process.env` _before any test module — and
therefore any `env.ts` — is imported_. This is what makes `createEnv()` validate
against the real running DB/Redis. Listed first in `setupFiles`, ahead of the
package's own setup.
_Avoid_: "the env mock", "the env setup"

**`backendProject(...)`** (`@acme/test-utils/vitest`):
The backend Vitest config preset. Folds the identical wiring — `staticTestEnv`
spread, `hydrate-env` ordering, testcontainer `globalSetup` (defaults to the
shared `@acme/test-utils/setup`, so a package needs no re-export file), single
non-isolated forked worker, generous timeouts — behind one call, so a package's
`vitest.config.backend.ts` declares only what's unique to it (`webapp`,
`redisDb`, its own setup file). A package overrides `globalSetup` only when it
has extra provisioning to do.
_`infra: false`_ opts a suite out of containers + env hydration entirely, for
suites whose externals are all mocked and that touch no DB/Redis (e.g. `ingest`):
env is still real, satisfied by `staticTestEnv` alone.

**Per-suite isolation knobs**:
`NEXT_PUBLIC_WEBAPP` (a dedicated Postgres schema) and `TEST_REDIS_DB` (a
dedicated Redis logical DB), set per package. turbo runs feature backend suites
concurrently against one shared DB/Redis; these keep a parallel suite's
cleanup/`flushDb` from wiping another's data. `NEXT_PUBLIC_WEBAPP` is the same
app-identity value that names the schema in prod (ADR 0008).
_Avoid_: "the test schema" (be specific: schema vs Redis DB)

## Relationships

- `staticTestEnv` covers only static vars; dynamic DB/Redis connection details
  come from **Env hydration**, and per-suite-unique values from the
  **isolation knobs**. The three tiers are disjoint by design.
- **Env hydration** reads the values `global-setup` publishes via
  `project.provide(...)`; they live only in the global-setup process otherwise,
  which is why the copy into `process.env` is necessary.
- `backendProject` imports `@acme/vitest-config/base` (a runtime dependency,
  since it is imported from shipped `src`) and layers the backend concerns on
  top; the base config is domain-free and holds only `NODE_ENV`.
- Frontend configs don't hydrate (all their env is static) and run in jsdom =
  client mode, so `env.ts` validates only client + shared vars.

## Design decisions

**Validate, don't skip** (ADR 0014): env mocks existed only because connection
details lived in `inject()`, not `process.env`. Hydration removes the reason to
mock, so every `env.ts` runs for real and a missing var fails loud at the seam.

**No `@acme/models` mock _for env reasons_**: ai-sdk provider factories build
config objects at import with no network, so `resolve.ts` constructs fine from
`staticTestEnv`; an env-shaped mock would only re-hide a seam that works under
real validation. A _behavioral_ mock is a different thing and still allowed — a
suite avoiding a real Bedrock call mocks the model's behavior (`@acme/rag`'s
fixed-vector embed model). The line: never mock `env` or in-repo infra; do mock
true externals for behavior.

**Static env is a plain string map, not derived from schemas**: `staticTestEnv`
is a hand-maintained record. Under loud validation (ADR 0014) drift is
self-correcting — a missing var fails the suite immediately — so deriving it
from each `env.ts` would add machinery for no safety gain.
