# Testing — agent brief

The full reference is [**docs/TESTING.md**](../TESTING.md). This is the
one-screen version: the rules an agent must not get wrong.

## The one principle

**Test the contract, not the internals.** Assert what's observable at the seam
that owns the behaviour (caller result + real DB/Redis state); never
`expect(mock).toHaveBeenCalledWith(...)`. One contract, one owner, one layer —
don't re-test middleware per-procedure, don't unit-test a private helper the
owning service already covers, don't give a platform module its own suite when
its contract is observable through a consuming feature.

## Where a test goes (backend, under `src/tests/backend/`)

Filed by **test type**, then **seam**. `unit/` is solitary; `integration/` is
sociable:

- **`unit/`** — **pure** logic, no I/O, no mocks. If it needs a mock, it's
  mis-placed. If its only effect is calling an injected dep, it's delegation —
  don't unit-test it.
- **`integration/api/`** — through the tRPC **router** (auth/tier/rate-limit middleware). Real DB/Redis.
- **`integration/service/`** — a module hitting real infra **directly** (Redis, Postgres, vector store), not reachable through a router.

Module with a pure core and an I/O shell? **Split it _only if the pure part is
independently a contract_** (a named policy/transform): pure → `unit/`, I/O →
`integration/service/` (see `subscriptions`' `credit-policy.ts` + `credits.ts`).
A private mapper isn't a contract — drive its branches by input shape through the
service test that owns the outcome.

## The rules

1. **Never mock `env` or in-repo infra** ([ADR 0014](../adr/0014-tests-validate-real-env.md)).
   Postgres, Redis, and every `env.ts` are real. Mock only true externals
   (LLM/Bedrock, Stripe, S3) and stub Clerk via the context. Need a branch a
   valid `env` can't produce? Configure the real env (`vi.stubEnv`), don't mock
   the env module.
2. **One test context.** Build callers from `@acme/trpc/testing`'s
   `createTestContext` (re-exported by each feature's `utils/test-context.ts`,
   which also owns `cleanupTestData`). Never hand-assemble a context; never inject
   `db` (it's bound by middleware).
3. **DDL comes from the Drizzle schema**, not hand-written SQL — derive it with
   `drizzle-kit/api` `generateMigration` in `setup.ts` (see `feedback`).
4. **Isolation is per-suite:** a dedicated Postgres schema (`webapp`) + Redis
   logical DB (`redisDb`), configured via `backendProject(...)`. Flush Redis with
   `flushTestDb` from `@acme/redis/testing`. Use `infra: false` for suites that
   touch no DB/Redis.
5. **Style:** test middleware once; zero/one/many; assert real state; don't test
   the framework.

## Config

`vitest.config.backend.ts` = `backendProject({ webapp, redisDb?, setupFiles?,
infra? })` from `@acme/test-utils/vitest`. Static env is `staticTestEnv`; live
DB/Redis details are hydrated by `@acme/test-utils/hydrate-env`.

Every package declares an `acme.testClass` block; `pnpm test:policy` enforces it.

## Frontend (under `src/tests/frontend/`)

Full doctrine: [**ADR 0018**](../adr/0018-frontend-test-doctrine.md) +
[docs/TESTING.md](../TESTING.md). The one rule: **fake the network at the HTTP
boundary (MSW); assert what renders.** The hook is the contract (logic lives in
`src/hooks/`).

- **Where it goes:** `unit/` (pure, no React), `integration/hooks/` (a hook via
  real `QueryClient` + MSW), `integration/components/` (component through its
  providers). Same words as the backend, weaker meaning — **MSW is the frontier,
  there's no real infra**.
- **Never** `vi.mock('../trpc/react')`, a feature hook, or `react-toastify` —
  ESLint blocks all three. Assert toasts via a real `<ToastContainer />`.
- **Never** `expect(spy).toHaveBeenCalledWith(...)` on the data layer — read the
  DOM/hook state. Framework externals (`next/navigation`, `@acme/auth`) stay
  mockable.
- **Reference:** `feedback` (setup + `feedback-buttons` + `use-feedback`);
  `ingest/documents-list` for the MSW-over-shallow-mock rewrite.
