# Test Utils (`@acme/test-utils`)

Shared testing substrate: the testcontainer lifecycle and the env plumbing that
lets suites validate real `env.ts` instead of mocking it (ADR 0014). It owns
_how_ tests get a running DB/Redis and a populated `process.env` — not _what_
any feature asserts.

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
spread, `hydrate-env` ordering, testcontainer `globalSetup`, single non-isolated
forked worker, generous timeouts — behind one call, so a package's
`vitest.config.backend.ts` declares only what's unique to it (`webapp`,
`redisDb`, its own setup file).

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

**No `@acme/models` mock**: ai-sdk provider factories build config objects at
import with no network, so `resolve.ts` constructs fine from `staticTestEnv`.
Mocking it would only re-hide a seam that already works under real validation.

**Static env is a plain string map, not derived from schemas**: `staticTestEnv`
is a hand-maintained record. Under loud validation (ADR 0014) drift is
self-correcting — a missing var fails the suite immediately — so deriving it
from each `env.ts` would add machinery for no safety gain.
