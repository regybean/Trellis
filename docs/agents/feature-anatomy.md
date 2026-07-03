# Feature package anatomy

How a `packages/features/*` package is laid out and why. This is the structural
companion to [CLAUDE.md](../../CLAUDE.md) (the boundary rules) and the per-package
[`CONTEXT.md`](../../CONTEXT-MAP.md) files (the domain language). Scaffold new
features with `pnpm turbo gen feature` — never by hand — and this is the shape it
produces.

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
      trpc.ts             # per-feature tRPC context + middleware (auth, rate limit, telemetry, db)
      root.ts             # appRouter — aggregates this feature's routers
      routers/<name>.ts   # the procedures (the BACKEND contract)
      schemas/*-schema.ts # drizzle tables + zod schemas
    env.ts                # type-safe env (@t3-oss/env-nextjs); validated, never mocked
    components/           # presentational UI only — MUST NOT import trpc or call hooks' data layer directly
    hooks/use-*.ts        # data access + business logic (the FRONTEND contract)
    trpc/
      react.tsx           # client provider + useTRPC(); plain httpLink under NODE_ENV==='test'
      server.tsx          # RSC / server-side caller
      query-client.ts     # shared QueryClient factory
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

## Exports & containment

- **Exports map** follows the bounded convention in
  [ADR 0015](../adr/0015-package-exports-convention.md), enforced by
  `scripts/check-exports.mjs` (hard-fails `pnpm lint`). Entry shape is
  `{ "types": "./dist/<name>.d.ts", "default": "./src/<name>.ts" }` — JIT source,
  compiled types. Bounded keys only (`.`, `./server`, `./schema`, `./env`,
  `./testing`, plus registered seams).
- **Vendor SDKs** (`@mastra/*`, framework-specific Clerk, `stripe`) are contained
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

- Test shared middleware (auth, rate limit) **once**; cover procedures with the
  **zero / one / many** pattern.
- Mock only what you can't run (Clerk, Stripe, S3, Bedrock); exercise real
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
- Framework externals (`next/navigation`, `@acme/auth`) stay mockable; prefer
  observable navigation (`<Link href>` in the DOM) over asserting `router.push`.
- **Reference:** `feedback` (setup + `feedback-buttons` + `use-feedback`).

### Test policy

Every package declares an `acme.testClass` block in `package.json`
(`full-stack` | `backend-library` | `none`); `pnpm test:policy` enforces that a
conforming package actually ships the suites its class requires, and that unit
folders stay mock-free.
