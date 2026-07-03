# Testing Guide

How tests work in the Trellis monorepo — the layer taxonomy, the fixtures, and
the rules. This is the canonical reference; `docs/agents/testing.md` is the short
agent-facing pointer to it.

## Quick start

```bash
pnpm --filter @acme/chat test            # a package's full suite
pnpm --filter @acme/chat test:backend    # backend only
pnpm --filter @acme/chat test:frontend   # frontend only
pnpm --filter @acme/chat test:backend:watch
pnpm test                                # everything (turbo)
```

Backend suites need Postgres + Redis. **Locally** they must already be running
(`pnpm infra:up`) on the standard ports (5432 / 6379); the global-setup checks
the ports and fails loudly if they're down. **In CI** (`CI=true`) the same
global-setup starts throwaway testcontainers and runs migrations, then tears
them down. Infra-less suites (see `infra: false` below) need neither.

## Test the contract, not the internals

The one principle everything else follows from: **each test targets the seam that
owns a contract and asserts what's observable at that seam — never re-asserts a
contract owned upstream, never reaches past the seam to check a mechanism.**

- Assert the **outcome**, not the call. `expect(mock).toHaveBeenCalledWith(...)`
  is the smell that you've dropped below the contract into an internal.
- **One contract, one owner, one layer.** If the api test already proves "webhook
  event → correct tier in Redis," don't _also_ unit-test the private mapper it
  uses. If every feature's api suite proves auth rejects, don't re-test the
  middleware in `@acme/trpc`.
- **Test where the contract becomes observable.** A platform module whose only
  contract surfaces through a consuming feature is tested at that feature's
  boundary — not given a redundant suite of its own.

## The test taxonomy: unit / integration(api · service)

Backend tests are filed by **test type**, then by **the seam under test**. Two
top-level folders under `src/tests/backend/` (`src/tests/` for platform packages):

| Folder                | Type                                    | Seam under test                                                                                       | Infra                   | Examples                                                                       |
| --------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `unit/`               | **Unit** (solitary — no collaborators)  | **Pure logic** — transforms, policy, parsing                                                          | None (no I/O, no mocks) | `unit/credit-policy.test.ts`, `unit/chat-memory.test.ts`, `unit/stripe-webhook.test.ts` |
| `integration/api/`    | **Subcutaneous** (through the router)   | The tRPC **router** — the feature's public interface, through all middleware (auth, tier, rate-limit) | Real DB/Redis           | `integration/api/account.test.ts`, `integration/api/chat.test.ts`             |
| `integration/service/`| **Integration** (one module ↔ infra)    | A **service/module** that hits real infra directly (not through the router)                           | Real DB/Redis           | `integration/service/credits.test.ts`, `integration/service/document-uploader.test.ts` |

The top axis is the **test type** (unit vs integration); `integration/`
subdivides by **seam** (through the router = `api/`, direct to infra =
`service/`). `unit/` is _solitary_ (Fowler's term — no collaborators); the
`integration/` tests are _sociable_ (real router, real infra).

Rules of thumb — **the seam decides placement**, not ceremony:

- Goes through `appRouter.createCaller(...)` → **integration/api**.
- Touches Redis/Postgres/vector-store directly, not reachable through a router →
  **integration/service**.
- Pure function, no I/O to mock away → **unit**. A unit test that needs a mock to
  run is mis-placed (it's really an integration test) or is testing the wrong
  seam. If a "pure" function's _only_ observable effect is a call to an injected
  dependency, it's delegation — don't unit-test it; assert the real effect in
  `integration/`.
- If a procedure can reach it, prefer **api** (you get the middleware for free).
  If only non-tRPC callers reach it (e.g. `syncStripeDataToKV`, called by the
  webhook handler + dev tooling), it's a **service** test.

**Split a pure core from its I/O shell _only when the pure part is independently a
contract_** — a policy/parse/transform a domain expert would name. `credits` is
the worked example: `credit-policy.ts` (per-tier limits + billing window — a real
policy) is tested in `unit/`, while the Redis-backed operations are tested against
a real Redis in `integration/service/`. Don't mint a `unit/` test for a private
mapper (e.g. billing's `buildSubscriptionCache`) — its branches are driven by
_input shape_ through the service test that owns the outcome.

Frontend tests live under `src/tests/frontend/` (`*.test.tsx`, jsdom + Testing
Library + MSW).

## What is real vs mocked

Per [ADR 0014](adr/0014-tests-validate-real-env.md): **tests validate the real
`env.ts` and exercise real in-repo infrastructure. Never mock either.**

| Dependency                | Approach                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.ts` (every package)  | **Real** — validated against `createEnv`, never mocked. Static values come from `staticTestEnv`; live DB/Redis details are hydrated from the containers. |
| PostgreSQL / pgvector     | **Real** (testcontainers in CI, docker-compose locally).                                                                                                 |
| Redis                     | **Real** — same.                                                                                                                                         |
| Clerk auth                | Stubbed via the test context (`@acme/trpc/testing`) — we don't test Clerk.                                                                               |
| LLM / Bedrock, embeddings | Mocked — a true external. Behavioral fake (e.g. rag's fixed embed vector).                                                                               |
| Stripe, S3                | Mocked — true externals.                                                                                                                                 |
| OpenTelemetry             | Noop telemetry from the test context.                                                                                                                    |

The one rule that resolves every "should I mock this?": **mock true externals
(third-party network services); never mock `env` or in-repo infra.** Mocking a
third-party SDK for _behavior_ (e.g. `@acme/models`' embed model) is expected and
different from mocking `env` for _shape_ — the latter is what ADR 0014 forbids.

> Reaching a branch that a validated `env` can't produce? Configure the real env
> to reach it — don't mock the env module. Example: `redis`'s `namespace.test.ts`
> exercises the empty-namespace branch via `vi.stubEnv('CI','true')` (the real
> `skipValidation` path), not `vi.mock('../env')`.

## The tRPC test context

There is **one** canonical context builder, shipped from `@acme/trpc/testing` (a
dedicated export subpath — prod code never imports it). It is typed against the
real platform contract, and its `subscription`/`tier`/`credits` are derived from
the same mock `EntitlementsProvider` the real `createTRPCContext` would resolve,
so a test context can't drift from production.

```typescript
// src/tests/backend/utils/test-context.ts re-exports it + owns feature cleanup:
export { createTestContext } from "@acme/trpc/testing";
export type { TestContextOptions } from "@acme/trpc/testing";

// In a test:
import { createTestContext } from "../utils/test-context";
import { appRouter } from "../../../api/root";

function createCaller(opts: TestContextOptions) {
  return appRouter.createCaller(createTestContext(opts));
}

const caller = createCaller({
  userId: createTestUserId(),
  role: "user", // 'user' | 'admin'
  tier: "Basic", // 'Basic' | 'Standard' | 'Pro' → derives the subscription
  credits: { remaining: 250, limit: 250, resetAt: Date.now() },
});
```

`db` is **not** passed in the context — it's bound at the feature tRPC instance
by `createFeatureTRPCWithDb(db)` middleware. Tests never inject it.

### Data cleanup

Each feature's `utils/test-context.ts` owns a `cleanupTestData()` that deletes
its own tables and flushes Redis via `flushTestDb` from `@acme/redis/testing`.
Call it in `beforeEach`/`afterEach`. Per-suite isolation makes this safe: each
backend suite gets a **dedicated Postgres schema** (`webapp`) and a **dedicated
Redis logical DB** (`redisDb`), so a parallel suite's flush can't wipe yours.

## The vitest backend preset

`backendProject` (`@acme/test-utils/vitest`) folds the shared backend wiring into
one call; a package's `vitest.config.backend.ts` declares only what's unique:

```typescript
import { backendProject } from "@acme/test-utils/vitest";

export default backendProject({
  webapp: "chat", // Postgres schema + Redis key namespace for the suite
  redisDb: "2", // dedicated Redis logical DB (isolation)
  setupFiles: ["./src/tests/backend/setup.ts"],
  // infra: false,             // opt out of containers entirely (see below)
  // globalSetup: './src/tests/backend/global-setup.ts', // override only if you need custom provisioning
});
```

It sets: `staticTestEnv` + per-suite `NEXT_PUBLIC_WEBAPP`/`TEST_REDIS_DB`, the
`@acme/test-utils/hydrate-env` setup file (copies container connection details
into `process.env` before any `env.ts` loads), the shared testcontainer
`globalSetup`, and a single non-isolated forked worker with generous timeouts (a
real DB means tests share one deterministic connection space).

**`infra: false`** — for a suite whose externals are all mocked and touches no
DB/Redis (e.g. `ingest`): no containers start and env isn't hydrated, so it runs
anywhere. Env is still real, satisfied by `staticTestEnv`.

## Provisioning app-owned tables (DDL)

Never hand-roll `CREATE TABLE` SQL in tests — it drifts from the schema. Derive
it from the **same Drizzle schema production uses**. `feedback`'s `setup.ts` is
the pattern: in `beforeAll`, `drizzle-kit/api`'s `generateMigration` diffs an
empty DB against the feature schema and applies the resulting `CREATE`
statements. It runs in-worker (where `NEXT_PUBLIC_WEBAPP` names the isolated
schema the table lives in), is idempotent (tolerates "already exists" across
runs), and — being an empty→schema diff — never inspects or drops Mastra's
runtime `mastra_*` tables. Mastra's own tables are created lazily by the memory
fixtures.

## Mocking conventions

- **`mockReset: true`** is the base default — mock implementations are wiped
  before each test. Establish per-test default behavior in a `beforeEach` (chat's
  `chatAgent.stream` spy is the pattern).
- A suite with a large set of **stable stub implementations** may instead set
  `mockReset: false` and clear only call history with `vi.clearAllMocks()` in
  `beforeEach` (billing's Stripe/subscriptions stubs). If you do, say why in the
  config comment.
- `server-only` is mocked (`vi.mock('server-only', () => ({}))`) so server
  modules import under vitest.

## Test style

- **Test middleware once.** Every procedure shares the auth/tier/rate-limit
  stack; assert the unauthorized/forbidden paths once per package, not per
  procedure.
- **Zero, one, many.** Cover empty, single, and multiple-row cases.
- **Assert the outcome, not the mechanism.** Read data back through the same
  API/DB and assert real state; never assert `mock.toHaveBeenCalledWith(...)` —
  that tests an internal, not the contract.
- **Don't re-test an upstream contract.** Middleware once per package; don't
  re-assert a pure helper the owning service already covers by input shape.
- **Don't test the framework** (tRPC routing, Zod internals) or mocked services
  (Stripe API, LLM output).

## Package test policy

The root `pnpm test` is a trustworthy gate: every workspace package declares its
test capability so "no test script" is never ambiguous. Each `package.json`
carries an `acme` block, enforced by `pnpm test:policy`
([`scripts/check-test-policy.mjs`](../scripts/check-test-policy.mjs), wired into
`quality-gate`):

```jsonc
"acme": {
  "testClass": "backend-library", // capability class (see table)
  "testStatus": "todo",           // optional: a tracked-but-allowed gap
  "reason": "why this gap/exemption exists"
}
```

### Test classes

| `testClass`        | What it is                                  | Required scripts                                                                                   |
| ------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `full-stack`       | Ships an API router **and** UI              | `test`, `test:backend`, `test:backend:watch`, `test:frontend`, `test:frontend:watch`, `test:watch` |
| `backend-library`  | Runtime/server logic, no UI                 | `test`, `test:backend`, `test:backend:watch`                                                       |
| `frontend-library` | React UI primitives/hooks                   | `test`, `test:frontend`, `test:frontend:watch`                                                     |
| `app`              | Deployable application shell                | none (covered by feature/integration suites)                                                       |
| `none`             | Config / codegen / scripts, no runtime seam | none                                                                                               |

### `testStatus` and `reason`

- **Omitted** — the package exposes every script its class requires (conforming).
- **`"todo"`** — a library-class package that _should_ have tests but doesn't
  yet. The gate stays green; the gap is tracked, not lost. Requires a `reason`.
  List all gaps with `pnpm test:policy --todos`.
- `reason` is **required** when `testStatus` is `todo`, or when `testClass` is
  `app` or `none`.

The checker also warns when a `none` package ships `.tsx` (UI) or `src/api` (a
router) — a contradiction signalling it's mis-classified.

## Adding tests to a new package

> New packages scaffolded via `pnpm turbo gen` already include a compliant
> `acme` block; the steps below are for retrofitting.

1. Add a dev dependency on `@acme/test-utils` (and `@acme/trpc` if you build a
   tRPC caller context).
2. Create `vitest.config.backend.ts` with `backendProject({ webapp, redisDb? })`
   — pick an unused `redisDb` and a valid-identifier `webapp`. Use
   `infra: false` if the suite touches no DB/Redis.
3. Create `src/tests/backend/setup.ts` for behavioral mocks (LLM/Stripe/S3,
   `server-only`) and any DDL provisioning. Do **not** mock `env`.
4. Create `src/tests/backend/utils/test-context.ts` re-exporting
   `createTestContext` from `@acme/trpc/testing` and owning `cleanupTestData`.
5. Place tests under `unit/`, `integration/api/`, or `integration/service/` per
   the taxonomy above.
6. Add the class's `test*` scripts to `package.json` and drop any
   `acme.testStatus`/`reason` once real tests exist.
