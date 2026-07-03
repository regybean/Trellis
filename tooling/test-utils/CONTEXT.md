# Test Utils (`@acme/test-utils`)

Shared testing substrate: a generic testcontainer **engine** and the env
plumbing that lets suites validate real `env.ts` instead of mocking it (ADR
0014). It owns the _mechanism_ — turning a descriptor into a running container
and a populated `process.env` — not the knowledge of _which_ package needs what
infra (that's the suite) or _how_ each infra is built (that's the owner, via a
descriptor). See ADR 0017.

This package is **infra-only** and carries no per-infra knowledge: no pinned
Postgres/Redis image, no credentials, and (since ADR 0017) not even the
`@testcontainers/*` typed subpackages — it drives everything through
`testcontainers`' `GenericContainer` from descriptor data. The tRPC caller
context + mocks live in `@acme/trpc/testing`, the Redis flush helper +
`redisContainer` descriptor in `@acme/redis/testing`, and the `postgresContainer`
descriptor in `@acme/db/testing` — owned by the packages whose infra they
describe, since this tooling package sits below `platform`.

## Language

**`staticTestEnv`** (`@acme/test-utils/vitest`):
The single source of static, non-secret env spread into every suite's `test.env`
(backend and frontend). Values only need to satisfy each package's `env.ts`
schema — they never reach a real service. New static test vars go here, not into
a per-suite mock.
_Avoid_: "the env defaults", "the fake env"

**Env hydration** (`@acme/test-utils/hydrate-env`):
A backend setupFile that copies the connection details `global-setup` published as
one `infraEnv` record (`inject('infraEnv')`) into `process.env` _before any test
module — and therefore any `env.ts` — is imported_. This is what makes
`createEnv()` validate against the real running DB/Redis. Listed first in
`setupFiles`, ahead of the package's own setup.
_Avoid_: "the env mock", "the env setup"

**`runInfraSetup(descriptors)`** (`@acme/test-utils/setup`):
Returns a Vitest `globalSetup` function that starts exactly the named infra
(testcontainers in CI, an assumed compose stack locally), publishes the merged
connection env as one `infraEnv` record, and tears the containers down. A suite
calls it from a ~5-line per-suite `global-setup.ts` that imports its descriptors
as live objects.
_Avoid_: "the setup harness", "the container bootstrap"

**`backendProject(...)`** (`@acme/test-utils/vitest`):
The backend Vitest config preset. Folds the identical wiring — `staticTestEnv`
spread, `hydrate-env` ordering, the suite's `globalSetup`, single non-isolated
forked worker, generous timeouts — behind one call, so a package's
`vitest.config.backend.ts` declares only what's unique to it (`webapp`,
`redisDb`, its own setup file, and its `globalSetup` path).
_`globalSetup`_ points at the suite's per-suite `global-setup.ts` (see
**Infra descriptor**); its presence _is_ the signal the suite uses real infra
(hydrate-env is added, the container global-setup runs). Omit it for a suite whose
externals are all mocked and that touches no DB/Redis (e.g. `ingest`): env is
still real, satisfied by `staticTestEnv` alone.

**Infra descriptor** (`InfraDescriptor`, `@acme/test-utils/infra`):
A plain object describing one test container — image, ports, container env, wait
strategy, repo-relative bind mounts, and `provides(host, port)` (a function
mapping the running container to the `process.env` keys this infra populates).
Owned by the infra package (`postgresContainer`, `redisContainer`) and consumed
by the engine. A suite imports the descriptors it needs in its per-suite
`global-setup.ts` and hands them to `runInfraSetup([...])` — as live objects, so
no serialisation is involved.
_Avoid_: "the container config", "the infra registry"

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
