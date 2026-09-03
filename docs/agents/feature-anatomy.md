# Feature package anatomy

How a `packages/features/*` package is laid out and why. This is the structural
companion to [CLAUDE.md](../../CLAUDE.md) (the boundary rules) and the per-package
[`CONTEXT.md`](../../CONTEXT-MAP.md) files (the domain language). Scaffold new
features with `pnpm turbo gen feature` — never by hand — and this is the shape it
produces.

> Mounting one of these in an app is the other side of this document: see [`docs/mounting/`](../mounting/) for the wiring, and the package's own `ADAPTER.md` for what it gives an app.

## The slice contract

**One feature = one package = router + hooks + UI, depending only downward**
(`features → shared → platform → tooling`). That single rule explains most of the
layout: logic lives in hooks, components stay presentational, and framework
specifics never leak in (they live in the app adapter). It's what lets an app
mount a different subset of features — a bespoke client is a new app importing a
different subset, not a fork.

## Directory layout

```
packages/features/<name>/
  package.json            # exports map + scripts + acme.testClass (see below)
  eslint.config.ts        # containmentOverride(...) if the feature needs a vendor SDK
  vitest.config.backend.ts / vitest.config.frontend.ts
  CONTEXT.md              # domain language for this feature (ubiquitous terms)
  src/
    api/
      trpc.ts             # the feature's context type, tRPC instance, middleware and db
      root.ts             # appRouter — aggregates this feature's routers
      routers/<name>.ts   # the procedures (the BACKEND contract)
      schemas/*-schema.ts # drizzle tables + zod schemas
    env.ts                # the slice env: one createEnv call, APP_ENV profiles (@acme/env ADR 0001); validated, never mocked
    components/           # presentational UI only — MUST NOT import trpc or call hooks' data layer directly
    hooks/use-*.ts        # data access + business logic (the FRONTEND contract)
    trpc/
      react.tsx           # tRPC provider + useTRPC(); plain httpLink under NODE_ENV==='test'
      server.tsx          # RSC / server-side caller
    index.ts              # public client entry
    index-server.ts       # ./server entry (server-only surface)
    index-schema.ts       # ./schema entry (drizzle/zod for app migrations)
    tests/                # see below
```

Not every feature has every part: a backend-only feature omits `components/`,
`hooks/`, `trpc/`, and frontend tests (the generator toggles these).

## The two contracts

- **Backend contract = the tRPC procedure** (`api/routers/*`). Tested under
  `tests/backend/integration/api/` against real Postgres/Redis.
- **Frontend contract = the hook** (`hooks/use-*`). Logic lives here, not in
  components, so this is what frontend tests drive. Tested under
  `tests/frontend/integration/hooks/`.

Components are the thin presentational layer over the hook. ESLint forbids a
component from importing `../trpc/*` or `@trpc/*` — all tRPC calls belong in
`hooks/`.

### One procedure per user intent — the server orchestrates

**The browser calls once per thing the user did; the server does the sequence.**
A user intent that needs three upstream calls is _one_ procedure, not three the
hook chains together. The frontend is deliberately dumb: it knows intents
(`start`, `send`, `import`), never the order upstream calls go in.

Why, concretely:

- **A chained sequence has no atomic step.** If the hook fires call 2 after call
  1 lands, a failure at 2 leaves state only the client knows about — and the
  client is the one thing you can't trust to finish (tab close, navigation,
  flaky network). Server-side, the whole sequence either produces a result or
  raises one error.
- **The client can't be trusted with an invariant.** "Always seed the
  conversation before the first message" is unenforceable if seeding is its own
  procedure — any caller can skip it.
- **Latency compounds per round-trip**, and each hop re-pays auth.
- **The contract stays the intent, not the mechanism.** Re-ordering, merging or
  replacing upstream calls is then a server change with no client change — the
  seam the slice contract exists to protect.

So: a procedure named for the intent, taking what the _user_ supplied, returning
what the UI renders. Where an upstream sequence is involved, it lives behind that
procedure in `api/routers/*` (or a `lib/` function it calls), tested as one
backend contract.

A hook firing a second mutation in the `onSuccess` of the first is the smell.

## Exports & containment

- **Exports map** follows the bounded convention in
  [ADR 0015](../adr/0015-package-exports-convention.md), enforced by
  `scripts/check-exports.mjs` (hard-fails `pnpm lint`). Entry shape is
  `{ "types": "./dist/<name>.d.ts", "default": "./src/<name>.ts" }` — JIT source,
  compiled types. Bounded keys only (`.`, `./server`, `./schema`, `./env`,
  `./testing`, plus registered seams).
- **Vendor SDKs** (`@mastra/*`, `better-auth`, `stripe`) are contained
  to blessed homes via ESLint `no-restricted-imports` (`tooling/eslint/base.ts`).
  A feature opts back in with `containmentOverride(...)` in its own
  `eslint.config.ts` — see CLAUDE.md's "Vendor-type containment".

## Tests

Two independent suites, split by config and driven by `test:backend` /
`test:frontend`. Full doctrine: [docs/TESTING.md](../TESTING.md).

### Backend — `tests/backend/` (real infra)

```
tests/backend/
  setup.ts / global-setup.ts   # testcontainers (real Postgres + Redis); mock only unownable edges
  utils/test-context.ts        # createTestContext(...) → appRouter.createCaller(ctx)
  utils/fixtures.ts            # seed helpers
  unit/                        # pure logic, no I/O, NO mocks
  integration/api/             # procedures via a caller against real infra (the contract)
  integration/service/         # a service/lib against real infra
```

- Test shared middleware (auth) **once**; cover procedures with the
  **zero / one / many** pattern.
- Mock only what you can't run (Stripe, S3, Bedrock); exercise real
  persistence. Env is real, validated, never mocked ([ADR 0014](../adr/0014-tests-validate-real-env.md)).

### Frontend — `tests/frontend/` (MSW at the HTTP boundary)

Doctrine: [ADR 0018](../adr/0018-frontend-test-doctrine.md) — **fake the network
at the HTTP boundary (msw-trpc + `setupServer`), assert what renders.** The same
`unit`/`integration` words as the backend, but weaker: **there is no real-infra
tier — MSW is the frontier, jsdom is the runtime.**

```
tests/frontend/
  setup.tsx                    # Providers, renderWithProviders, trpcMsw, jsdom polyfills
  unit/                        # pure logic, no React tree, no providers, no mocks
  integration/hooks/           # a hook via real QueryClient + MSW (the contract)
  integration/components/      # a component through its providers; assert DOM
```

- **Never** `vi.mock` the tRPC client (`../trpc/react`), a feature hook
  (`../hooks/*`), or `react-toastify` — those are the seams under test (ESLint
  blocks all three). Assert toasts via a real `<ToastContainer />` in the DOM.
- **Never** `expect(spy).toHaveBeenCalledWith(...)` on the data layer — read the
  outcome (DOM, returned hook state, cache), not the mechanism.
- Framework externals (`next/navigation`) stay mockable; prefer observable
  navigation (`<Link href>` in the DOM) over asserting `router.push`.
- **Reference:** `feedback` (setup + `feedback-buttons` + `use-feedback`).

### Test policy

Every package declares an `acme.testClass` block in `package.json`
(`full-stack` | `backend-library` | `none`); `pnpm test:policy` enforces that a
conforming package actually ships the suites its class requires, and that unit
folders stay mock-free.
