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
pnpm test:inventory                      # list every test without running one
```

Backend suites need Postgres + Redis, and they **always start their own**. The
global-setup boots throwaway testcontainers, pushes the schema, and tears them
down — identically everywhere: primary checkout, git worktree, CI. The only
prerequisite is a reachable container runtime (`podman machine start`); if there
isn't one, global-setup fails immediately with a message saying so.

`pnpm infra:up` is **not** a test prerequisite — it's dev infra. Testcontainers
binds random host ports, so a test run never touches the dev stack on 5444/6379
and dev state can never affect a result. There is one behaviour and one turbo
cache partition, so a local pass proves what a CI pass proves. See
[ADR 0034](adr/0034-backend-tests-always-self-provision.md). Infra-less suites
(see `infra: false` below) need no runtime at all.

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

Every package files its tests under **`src/tests/<layer>/<kind>[/<group>]/`** —
layer is `backend` or `frontend`, kind is `unit` or `integration`, group is the
optional seam segment below. The layer segment is there even in a package that
only has one side, so one glob works everywhere and the path prefix is a filter
axis tooling can trust; the two project factories own that glob, so no package
declares an `include`.

Backend tests are filed by **test type**, then by **the seam under test**. Two
top-level folders under `src/tests/backend/`:

| Folder                 | Type                                   | Seam under test                                                                                       | Infra                   | Examples                                                                                |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `unit/`                | **Unit** (solitary — no collaborators) | **Pure logic** — transforms, policy, parsing                                                          | None (no I/O, no mocks) | `unit/credit-policy.test.ts`, `unit/chat-memory.test.ts`, `unit/stripe-webhook.test.ts` |
| `integration/api/`     | **Subcutaneous** (through the router)  | The tRPC **router** — the feature's public interface, through all middleware (auth, tier, rate-limit) | Real DB/Redis           | `integration/api/account.test.ts`, `integration/api/chat.test.ts`                       |
| `integration/service/` | **Integration** (one module ↔ infra)   | A **service/module** that hits real infra directly (not through the router)                           | Real DB/Redis           | `integration/service/credits.test.ts`, `integration/service/document-uploader.test.ts`  |

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

## Frontend tests (`src/tests/frontend/`)

Frontend tests reuse the same two folders — `unit/` and `integration/` — but the
words mean something weaker here, because the frontend has **no real-infra tier**.
The doctrine is [ADR 0018](adr/0018-frontend-test-doctrine.md); this is how it
files.

| Folder                    | Type                       | Seam under test                                                             | Network                                           | Examples                                                        |
| ------------------------- | -------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `unit/`                   | **Unit** (solitary)        | **Pure logic** — a transform/policy with no React tree                      | None (no providers, no mocks)                     | `unit/upload-validation.test.tsx`, `unit/date-buckets.test.tsx` |
| `integration/hooks/`      | **Integration** (sociable) | A **hook** — the feature's logic contract, run through a real `QueryClient` | Faked at HTTP boundary (**MSW**)                  | `integration/hooks/use-feedback.test.tsx`                       |
| `integration/components/` | **Integration** (sociable) | A **component** rendered through its providers                              | MSW if it composes a hook; none if presentational | `integration/components/documents-list.test.tsx`                |

### unit / integration mean different things on BE vs FE

The vocabulary is shared; the fidelity is not. Read the mapping before filing:

| Term            | Backend                                        | Frontend                                                                                                                                  |
| --------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **unit**        | Pure logic, no I/O, **no mocks**.              | Pure logic, **no React tree**, no providers, no mocks.                                                                                    |
| **integration** | Wired to **real infra** — real Postgres/Redis. | Wired to a **real React tree + `QueryClient`**; network faked at the HTTP boundary (MSW). No real infra exists — **MSW is the frontier**. |
| _the contract_  | The tRPC **procedure** (`integration/api`).    | The **hook** (`integration/hooks`) — logic lives in `src/hooks/` per the slice contract.                                                  |

So a frontend `integration` test is sociable but still hermetic (jsdom + MSW),
where a backend `integration` test touches live containers. That asymmetry is
_why_ this mapping is written down.

### The one rule, and its dos & don'ts

**Fake the network at the HTTP boundary (MSW); assert what renders.** Everything
below follows from that.

- **DO** intercept with `trpcMsw` + `setupServer` from the feature's
  `tests/frontend/setup.tsx`; the real tRPC client + `QueryClient` run beneath.
- **DO** assert the observable outcome — DOM (`screen.findByText`, `aria-pressed`,
  a row disappearing), returned hook state, or cache contents.
- **DO** assert toasts by rendering a real `<ToastContainer />` and finding the
  message text in the DOM (`await screen.findByText('Document deleted')`).
- **DON'T** `vi.mock('../trpc/react')` or `vi.mock` a feature hook — that mocks
  the seam under test. (ESLint blocks it.)
- **DON'T** `expect(spy).toHaveBeenCalledWith(...)` on a data-layer mock, or
  assert a handler-side flag flipped — read the outcome, not the mechanism.
- **DON'T** `vi.mock('react-toastify')` — the toast renders in jsdom; assert it.
- **Framework externals stay mockable:** `next/navigation` — the frontend's
  blessed mock list (mirrors ADR 0014). `@acme/auth` is not on it: it ships no
  React, so no frontend test imports it
  ([@acme/auth ADR 0001](../packages/shared/auth/docs/adr/0001-self-hosted-better-auth.md)).
  Prefer observable navigation
  (`<Link href>` in the DOM) over asserting an imperative `router.push`.

### Setup and config

Each feature owns `src/tests/frontend/setup.tsx` exporting `renderWithProviders`
(wraps in `AppQueryClientProvider` + the feature's `TRPCProvider`, and
`<ToastContainer />` when the feature toasts)
and `trpcMsw` (a `createTRPCMsw<AppRouter>` bound to the feature's tRPC endpoint)
— plus `import '@acme/test-utils/jsdom'`, the shared side-effect module holding
the jsdom polyfills Radix needs (`ResizeObserver`, pointer-capture,
`scrollIntoView`). The config is `vitest.config.frontend.ts`
— one call to `frontendProject` (see below). `feedback`'s
setup + `feedback-buttons` / `use-feedback` tests are the reference; `ingest`'s
`documents-list` is the worked example of the MSW-over-shallow-mock rewrite.

A **library** package with no provider tree (`@acme/ui`, `@acme/hooks`) owns a
plain `setup.ts` instead: nothing to wrap, so no `renderWithProviders` and no
JSX — its tests `render` prop-driven components directly. The `staticTestEnv`
spread still applies.

## What is real vs mocked

Per [ADR 0014](adr/0014-tests-validate-real-env.md): **tests validate the real
`env.ts` and exercise real in-repo infrastructure. Never mock either.**

| Dependency                | Approach                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.ts` (every package)  | **Real** — validated against `createEnv`, never mocked. Static values come from `staticTestEnv`; live DB/Redis details are hydrated from the containers. |
| PostgreSQL / pgvector     | **Real** — a throwaway testcontainer per suite, on every run.                                                                                            |
| Redis                     | **Real** — same.                                                                                                                                         |
| Auth                      | Stubbed via the test context (`@acme/trpc/testing`) — we don't test the provider.                                                                        |
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
real platform contract and builds a context exactly the way an app resolver builds
a real one: the session, plus whatever the feature's own context adds on top of
`BaseContext`, passed through untouched, with nothing resolved up front (#250,
#256, #264).

The builder takes the `session` whole, not a `userId` + `role` it fabricates one
from, because which fields matter is the feature's knowledge: billing's tests set
the `email` its Stripe customer lookup reads; the other three need identity and
role. So each feature's `test-context.ts` wraps the builder, maps the knobs its
tests pass onto its own principal, and supplies whatever else its context names.

Most features' contexts are exactly `BaseContext`, and their wrapper is the whole
of it:

```typescript
// src/tests/backend/utils/test-context.ts wraps it + owns feature cleanup:
import type { InjectedUser } from "@acme/trpc";
import {
  createMockSession,
  createTestContext as createBaseTestContext,
  type FeatureTestContextOptions,
} from "@acme/trpc/testing";

export type TestContextOptions = FeatureTestContextOptions;

export function createTestContext({ userId, role }: TestContextOptions) {
  const user: InjectedUser = { id: userId, role };
  return createBaseTestContext({ session: createMockSession(user) });
}

// In a test:
import { createTestContext } from "../utils/test-context";
import { appRouter } from "../../../api/root";

function createCaller(opts: TestContextOptions) {
  return appRouter.createCaller(createTestContext(opts));
}

const caller = createCaller({
  userId: createTestUserId(),
  role: "user", // 'user' | 'admin'
});
```

`@acme/chat` and `@acme/billing` do declare one — an `EntitlementsProvider`,
because they meter credits and gate on tier — so their wrappers take the tier and
credit knobs too and hand over a mock provider. That mock ships from
`@acme/entitlements/testing`, beside the contract it implements, so a feature with
no tier never imports one:

```typescript
import {
  createMockEntitlements,
  type TestEntitlementsOptions,
} from "@acme/entitlements/testing";

export interface TestContextOptions
  extends FeatureTestContextOptions, TestEntitlementsOptions {}

export function createTestContext({
  userId,
  role,
  ...entitlements
}: TestContextOptions) {
  const user: InjectedUser = { id: userId, role };
  return createBaseTestContext({
    session: createMockSession(user),
    // `tier` derives a tier-faithful subscription; `consume`/`refund` no-op, and
    // `isTierAtLeast` is the real ordering — so a tier gate behaves as in prod.
    entitlements: createMockEntitlements(entitlements),
  });
}
```

`db` is **not** passed in the context — the feature creates and exports it in
`api/trpc.ts`, and its routers import it. Tests import that same export when they
need to seed or clean, and never inject one (#264).

### Data cleanup

Each feature's `utils/test-context.ts` owns a `cleanupTestData()` that deletes
its own tables and flushes Redis via `flushTestDb` from `@acme/redis/testing`.
Call it in `beforeEach`/`afterEach`. Per-suite isolation makes this safe: each
backend suite gets a **dedicated Postgres schema** (`webapp`) and a **dedicated
Redis logical DB** (`redisDb`), so a parallel suite's flush can't wipe yours.

## The vitest project presets

`backendProject` and `frontendProject` (`@acme/test-utils/vitest`) fold the
shared per-side wiring into one call each; a package's
`vitest.config.<side>.ts` declares only what's unique. Neither takes an
`include` — the layout above is the factory's to own, not a caller's.

```typescript
import { backendProject } from "@acme/test-utils/vitest";

export default backendProject({
  webapp: "chat", // Postgres schema + Redis key namespace for the suite
  redisDb: "2", // dedicated Redis logical DB (isolation)
  setupFiles: ["./src/tests/backend/setup.ts"],
  globalSetup: "./src/tests/backend/global-setup.ts", // omit for an infra-less suite (see below)
});
```

It sets: `staticTestEnv` + per-suite `NEXT_PUBLIC_WEBAPP`/`TEST_REDIS_DB`, the
`@acme/test-utils/hydrate-env` setup file (copies container connection details
into `process.env` before any `env.ts` loads), the shared testcontainer
`globalSetup`, and a single non-isolated forked worker with generous timeouts (a
real DB means tests share one deterministic connection space).

**Omitting `globalSetup`** — for a suite whose externals are all mocked and
which touches no DB/Redis (e.g. `@acme/models`): no containers start and env
isn't hydrated, so it runs anywhere. Env is still real, satisfied by
`staticTestEnv`.

The frontend side takes only its setup files — there is no infra to provision,
because MSW is the frontier (ADR 0018):

```typescript
import { frontendProject } from "@acme/test-utils/vitest";

export default frontendProject({
  setupFiles: ["./src/tests/frontend/setup.tsx"],
});
```

It sets: the react plugin, `environment: 'jsdom'`, and the `staticTestEnv`
spread so jsdom's client mode validates every reachable `env.ts` against real
values (ADR 0014).

## Provisioning app-owned tables (DDL)

Never hand-roll `CREATE TABLE` SQL in tests — it drifts from the schema. Every
Postgres a suite starts is empty, so the global-setup provisions tables by running
`drizzle-kit push --force` against the canonical full app (`apps/nextjs`) with
`NEXT_PUBLIC_WEBAPP` set to the suite's isolated schema — the same declarative
push dev uses (`pnpm db:push`), reading `schema.ts` directly (this repo has no
migration SQL, so `migrate` provisions nothing). One push creates every
push-managed table (the app re-exports each feature's schema) into that schema;
suites add no provisioning of their own. `mastra_*` and pgvector tables are
excluded by the push config's `tablesFilter` and created lazily at runtime. See
[ADR 0021](adr/0021-test-schema-provisioning-db-push.md).

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

## Seeing what the suite covers

```bash
pnpm test:inventory        # markdown, on stdout, seconds, no containers
pnpm test:inventory > inventory.md
```

Test names in this repo read as behaviour, but a passing run's scrollback is the
only place they appear, which makes them impossible to audit. `pnpm
test:inventory` prints every collected test grouped by package — layer
directories in dependency order (tooling, platform, shared, features),
alphabetical within each, the path under `src/tests/` as the group heading, a
count in every heading and a total at the end.

It reads from `vitest list --json`, run per package config, so it honours each
package's real `include` and resolves computed (`it.each`) names — the report is
what runs, not what a glob guesses. The corollary is that a `.skip` or `.todo`
appears nowhere: `vitest list` collects only what would run.

Listing normally fires `globalSetup`, which would start every backend suite's
testcontainers and push a schema purely to print names. So the tool sets
`VITEST_LIST_ONLY`, which `backendProject` reads to omit `globalSetup`.
Collection needs no infra — every reachable `env.ts` still validates against
`staticTestEnv` — so the inventory runs anywhere, with no container runtime.

Nothing is written to the repo and nothing enters the quality gate: this is an
ad-hoc read, not an artifact.

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
   — pick an unused `redisDb` and a valid-identifier `webapp`. Omit
   `globalSetup` if the suite touches no DB/Redis.
3. Create `src/tests/backend/setup.ts` for behavioral mocks (LLM/Stripe/S3,
   `server-only`) and any DDL provisioning. Do **not** mock `env`.
4. Create `src/tests/backend/utils/test-context.ts` re-exporting
   `createTestContext` from `@acme/trpc/testing` and owning `cleanupTestData`.
5. Place tests under `src/tests/backend/` in `unit/`, `integration/api/`, or
   `integration/service/` per the taxonomy above.
6. Add the class's `test*` scripts to `package.json` and drop any
   `acme.testStatus`/`reason` once real tests exist.
