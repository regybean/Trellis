# Tests validate real env instead of mocking `env.ts`

Test suites let each package's `env.ts` (`createEnv`) run and validate for real
against a populated `process.env`, rather than `vi.mock('../../env', …)`-ing it
(and every deeper env in the dependency tree) in each `setup.ts`. Env is
supplied in three tiers: static non-secret values in `staticTestEnv`
(`@acme/test-utils/vitest`) spread into every suite; per-suite-unique values
(`NEXT_PUBLIC_WEBAPP` schema, `TEST_REDIS_DB`) set per package; and dynamic
per-run testcontainer connection details hydrated into `process.env` by the
`@acme/test-utils/hydrate-env` setupFile before any module imports. Only
behavioral/IO boundaries (`@acme/subscriptions`, `server-only`, `next/navigation`,
`@acme/auth`, …) are still mocked.

## Considered Options

- **Skip validation in tests** (`SKIP_ENV_VALIDATION=true`, the previous state):
  kept configs terse but meant `env.ts` never ran, so every suite hand-rolled an
  env mock — bloat that drifted from the real schema and hid missing-var bugs
  until production.
- **Validate against real env** (chosen): the seam behaves in tests exactly as in
  prod — a missing/invalid var fails loud at `createEnv`, and env mocks vanish.

## Consequences

- No `@acme/models` mock is needed **for env reasons**: ai-sdk provider factories
  only build config objects at import (no network), so `resolve.ts` constructs
  fine from `staticTestEnv` — an env-shaped mock of it would only re-hide that
  seam. This is separate from a _behavioral_ mock: a suite that must avoid a real
  Bedrock call still mocks `@acme/models`' model behavior (e.g. `@acme/rag` swaps
  in a fixed-vector embed model). The rule is precise — never mock `env` or
  in-repo infra (Postgres/Redis); do mock true externals (LLM/Bedrock, Stripe,
  S3) for behavior. See [docs/TESTING.md](../TESTING.md).
- Backend suites need Docker/podman (testcontainers) to hydrate DB/Redis — the
  price of validating connection env for real. In CI, `env.ts`'s own
  `skipValidation` short-circuits on `CI`, but `hydrate-env` still populates the
  real connection values so the DB actually connects.
- New static vars go in one place (`staticTestEnv`), not scattered across mocks.
