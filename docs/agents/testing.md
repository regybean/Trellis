# Testing — agent brief

The full reference is [**docs/TESTING.md**](../TESTING.md). This is the
one-screen version: the rules an agent must not get wrong.

## Where a test goes (backend, under `src/tests/backend/`)

Group by the **seam under test**:

- **`api/`** — through the tRPC **router** (auth/tier/rate-limit middleware). Real DB/Redis.
- **`service/`** — a module hitting real infra **directly** (Redis, Postgres, vector store).
- **`domain/`** — **pure** logic, no I/O, no mocks. If a domain test needs a mock, it's mis-placed.

Module with a pure core and an I/O shell? **Split it**: pure → `domain/`, I/O →
`service/` (see `subscriptions`' `credit-policy.ts` + `credits.ts`).

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
