# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Navigation protocol — read before you search or edit

Consult the map before grepping; it turns most searches into a direct jump.

1. **Locating code in a feature/package?** Don't grep first. Read its
   [CONTEXT-MAP.md](CONTEXT-MAP.md) row → the package's `CONTEXT.md`, then
   [docs/agents/feature-anatomy.md](docs/agents/feature-anatomy.md) for the exact
   layout (`api/routers/*`, `hooks/use-*`, `api/schemas/*`). Jump to the file.
2. **Hunting a symbol across packages?** ripgrep scoped to `packages/`/`apps/`
   — no LSP server runs here, so go-to-definition is unavailable.
3. **Broad / cross-layer search** (a seam wired app→feature→platform; all callers
   of X): delegate to the `Explore` subagent so the fan-out stays out of this
   context. Single greps and known-location lookups stay inline.
4. **Before calling a change done:** `pnpm turbo run lint typecheck -F @acme/<pkg>`
   (cached, seconds — catches boundaries/exports/`as`/`useEffect`). Full
   `pnpm quality-gate` still runs once at end of task (ADR 0020).

> `turbo` is not installed globally — always invoke it as `pnpm turbo …`.

## Project Overview

Trellis is a Turborepo monorepo RAG starter. The architecture enforces strict boundaries between layers using turbo.json and pnpm workspace configuration. The main motivation for trellis is to be able to maintain many different apps with forward feature compatibility, aka you update one feature and all the other apps immediately gain the improvements. This and all other codebase patterns are enforced with linting rules and other tooling, if you are doing something wrong the gates will flag it.

The repository works using vertical feature slices that are:

- Full stack feature slices with both BE and FE code
- Isolated between one another
- Define their own infrastructure
- Define their own testing infrastructure
- Define their own database schema and api router
- Define their own UI components and pages
- Can be implemented by any of the nextjs or tanstack start applications
- Potentially composed using other packages

There is also a large focus on tooling, DDD and LLM HITL skills to improve the design process and to not let the LLM make architectural decisions without oversight.

## Commands

### Code Quality

```bash
pnpm lint                # Run ESLint across all packages
pnpm lint:fix            # Auto-fix linting issues
pnpm format              # Check Prettier formatting
pnpm format:fix          # Auto-fix formatting issues
pnpm lint:ws             # Check workspace consistency with sherif
pnpm boundaries          # Verify layer boundary violations
```

### Building and Testing

```bash
pnpm build               # Build all packages
pnpm typecheck           # Type check all packages
pnpm test                # Run all tests via Vitest
pnpm test:backend        # Backend tests only (real Postgres/Redis via testcontainers)
pnpm test:frontend       # Frontend tests only (jsdom + MSW at HTTP boundary)
pnpm test:watch          # Run tests in watch mode
pnpm turbo run test -F <pkg>  # Run tests for a single package (turbo isn't global)
pnpm test:policy         # Enforce per-package acme.testClass coverage
```

Tests split into `test:backend` (real Postgres/Redis via testcontainers) and
`test:frontend` (jsdom + MSW at the HTTP boundary). Doctrine: [docs/TESTING.md](docs/TESTING.md),
backend taxonomy in [docs/agents/testing.md](docs/agents/testing.md), frontend
doctrine in [ADR 0018](docs/adr/0018-frontend-test-doctrine.md). Rule of thumb:
**test the contract, not the internals** — the tRPC procedure on the backend, the
hook on the frontend; never `vi.mock` a seam the feature owns. Frontend: assert rendered DOM and hook state, never mock call counts; toasts go through `<ToastContainer />` in the test wrapper, asserted through the DOM. Env is never mocked — tests run against real env values ([ADR 0014](docs/adr/0014-tests-validate-real-env.md)). More information about testing can be found in testing.md

### Infrastructure & Database

```bash
pnpm infra:up            # Start local services — profile derived from acme.infra package metadata (ADR 0009)
pnpm infra:down          # Stop services
pnpm infra:logs          # Tail compose logs
pnpm with-env <cmd>      # Run cmd with .env hydrated
pnpm db:push             # Push schema changes, dev only (run)
```

### Full Validation

```bash
pnpm quality-gate        # lint + format + typecheck + build + boundaries + test:policy + gitleaks + test
```

> In a git worktree, dev/infra/env/database commands are manual-only — do not run them. On the primary checkout (e.g. `main`) you may run them to test. Tests are the exception: in a worktree `pnpm test` self-provisions isolated testcontainers (it's treated as CI — no `pnpm infra:up` needed) and the turbo cache is partitioned so a worktree run never replays the primary checkout's result. See [ADR 0019](docs/adr/0019-worktrees-mirror-ci-test-infra.md).

## Architecture

### Layer boundaries

```
tooling → platform → shared → features → apps
```

- **tooling**: Shared configs (ESLint, Prettier, TypeScript, Tailwind, Vitest, test-utils, github). Depends on tooling only.
- **platform**: Runtime substrate — the rails features run on (logger, telemetry, redis, subscriptions, trpc, db, entitlements). Depends on platform and tooling.
- **shared**: Reusable primitives (ui, hooks, auth, rag, models). Depends on shared, platform, and tooling.
- **features**: Domain modules. Depends on shared, platform, and tooling only.
- **apps**: Applications. Depends on all layers; own their shell/chrome. The compositions layer was removed ([ADR 0011](docs/adr/0011-remove-compositions-layer.md)) — the boundary tag is `app`.

### tRPC Architecture (v11)

Each feature defines its own router in `src/api/root.ts` and tRPC context in `src/api/trpc.ts` (includes Clerk auth, db clients, billing tier, Redis, OTel).

Features export `TRPCReactProvider` from `src/trpc/react.tsx`, routing to `/api/trpc/<feature-name>`. Apps wire the Next.js handler at `src/app/api/trpc/<feature-name>/[trpc]/route.ts`.

**Usage patterns**:

```typescript
// Client: use useTRPC() from feature's trpc/react.tsx
const trpc = useTRPC();
const query = useQuery(trpc.jobs.list.queryOptions(input, options));
const mutation = useMutation(trpc.jobs.create.mutationOptions(options));
const subscription = useSubscription(
  trpc.chat.stream.subscriptionOptions(input),
);
```

**Key principles**:

- Business logic in `src/hooks/` within feature packages
- Components UI-focused only — don't call tRPC directly from components
- Server-side: import from `src/trpc/server.tsx` for direct tRPC calls

**Injection seams** — apps own these, packages must not implement them:

- **Auth**: resolved at the app boundary (Clerk for full apps; constant `LOCAL_PRINCIPAL` for slim apps), injected as `{ auth, user }` into `createTRPCContext`. Packages never import `@clerk/nextjs/server` or `@clerk/tanstack-react-start/server`.
- **Entitlements**: injected as `subscriptionsEntitlements` (full) or `unlimitedEntitlements` (slim) — no implicit default; a missing provider silently grants Pro access to every caller.
- **Billing context**: fetched eagerly from Redis on every procedure — there is no per-feature opt-out.
- **Telemetry**: `createTelemetryContext()` returns a noop; OTel SDK is initialized per-app in `instrumentation.ts` (Next.js) or a Nitro plugin (TanStack Start).

### Rate Limiting

```typescript
.use(rateLimit({ tokens: 5 })) // Consumes tokens per request
```

Tokens are tier-based (free/standard/pro) stored in Redis. Available via tRPC middleware.

### Redis

All keys must be created via `nsKey(key)` from `@acme/redis` — produces a branded `NamespacedKey` type; passing a raw `string` is a compile error. Key builders (e.g. `creditKey`) live in domain packages, not in `@acme/redis`. Namespace is derived from `NEXT_PUBLIC_WEBAPP`.

### Database

All app-owned tables live under `pgSchema(NEXT_PUBLIC_WEBAPP)` — per-app Postgres schema isolation. `@acme/db` exports the sole connection factory (`createDb()`); features import it rather than declaring their own DB env. Migrations are app-owned (`db:push` / `db:migrate` run from the app, not the platform).

### RAG / Mastra

`@acme/rag` provides document upload, pgvector storage, retrieval, and Mastra Memory — wired to AWS Bedrock via `@acme/models`. Chat Agent lives in `@acme/chat`; `pnpm studio` / `pnpm lint:mastra` target `packages/features/chat/src/mastra`. See [ADR 0002](docs/adr/0002-mastra-rag-and-memory.md).

Critical constraints:

- `mastra_*` tables are DDL-owned by Mastra at runtime — **never manage them with drizzle-kit**; `db:push` explicitly scopes them out.
- `ensureVectorIndex()` runs at app boot (`instrumentation.ts`) — PgVector creates the table lazily on first upsert, so reads break on a fresh DB without it.
- Thread ownership is a rule not a DB constraint — `assertThreadOwned` (from `@acme/rag`) is reused by both `@acme/chat` and `@acme/feedback`; Mastra rows carry no row-level auth.
- `EMBED_DIMENSIONS` in `@acme/models` is the single source of truth for both the PgVector index size and the Drizzle mirror — change it in one place.
- OTel spans are created automatically for all tRPC procedures via middleware — use `ctx.telemetry.set()`, `.event()`, `.span()` inside procedures.

### Feature package structure

For the full anatomy of a `packages/features/*` package — directory layout, the two contracts (tRPC procedure / hook), exports, and the test taxonomy — see [docs/agents/feature-anatomy.md](docs/agents/feature-anatomy.md). Scaffold new features with `pnpm turbo gen feature`, never by hand.

### Slice contract enforcement

Inside `packages/features/*/src/components/`, components **must not** import a
feature's tRPC client (`../trpc/react`, `../trpc/server`) or `@trpc/*`. All tRPC
calls belong in `src/hooks/`; components stay presentational. Enforced by ESLint
(`no-restricted-imports` on component paths in `tooling/eslint/base.ts`).

### Vendor-type containment

Framework/vendor SDKs are contained to named homes, enforced by ESLint
(`no-restricted-imports`, `tooling/eslint/base.ts`). Default: every package bans
them; blessed homes opt back in via `containmentOverride(...)` in their own
`eslint.config.ts`.

- **`@mastra/*`** — only `@acme/rag` and `@acme/chat` (ADR 0002).
- **Framework-specific Clerk** (`@clerk/nextjs/server`,
  `@clerk/tanstack-react-start/server`) — only apps and `@acme/auth` (ADR 0003).
  The one blessed feature-level exception is `@acme/billing`'s `server-next`
  adapter (`stripe-success-handler.tsx`), which carries an inline
  `eslint-disable` citing ADR 0003. Type-only Clerk imports are allowed.

Adding a new blessed home means editing that package's `eslint.config.ts`, not
weakening the default.

`stripe` is not guarded by ESLint — it is contained to `@acme/billing` by the
dependency graph (billing is the only package that declares it), which `knip`
and `syncpack` keep honest.

### Package exports convention

Every runtime package (`packages/platform|shared|features`) has a
`package.json` `exports` map following a bounded, concern-driven convention,
enforced by `scripts/check-exports.mjs` (hard-fails `pnpm lint`).
`tooling/*` config packages are out of scope. See
[ADR 0015](docs/adr/0015-package-exports-convention.md).

- **Entry shape:** `{ "types": "./dist/<name>.d.ts", "default": "./src/<name>.ts" }`
  (JIT source, compiled types). Never point `default` at `dist` or `types` at `src`.
- **Bounded keys:** roles `.`, `./server`, `./schema`, `./env`, `./testing` +
  registered seams (`./handler`, `./register`, `./server-next`,
  `./ownership-trpc`). A new key is a deliberate edit to `ALLOWED_KEYS` in the
  checker.
- **Concern-driven presence:** export a role when the package has that concern,
  not when a consumer imports it today; never fabricate empty modules.
- **Naming:** role barrel (≥2 re-exports) → `index-<role>.ts`; single-concern
  module → `<name>.ts`.
- **`sideEffects`:** every package declares it. `false` for pure/leaf packages;
  array form listing files that hold a bare `import 'server-only'` guard or a
  side-effecting entry (so tree-shaking can't elide them).

## Development Patterns

### Adding a New Package

Always use the turbo generator — never create packages manually:

```bash
pnpm turbo gen
```

### Adding a New Feature

1. Run `pnpm turbo gen` and select the feature generator
2. Define tRPC context in `src/api/trpc.ts` with db clients
3. Create routers in `src/api/routers/` and aggregate in `src/api/root.ts`
4. Export components, hooks, and TRPCReactProvider from `src/index.ts`
5. Create React provider in `src/trpc/react.tsx`
6. Add API route in app at `src/app/api/trpc/<name>/[trpc]/route.ts`

## Agent Skills

Skills are vendored into `.agents/skills/` (committed; pinned by `skills-lock.json`). Claude only discovers a skill once it's symlinked into `.claude/skills/`, which is gitignored — so symlinks don't survive a clone. `scripts/register-skills.sh` recreates them idempotently from `.agents/skills/` and runs automatically on `postinstall`. Run `pnpm skills:register` manually after adding/removing a skill.

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical label strings (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout — `CONTEXT-MAP.md` at root points to per-package `CONTEXT.md` files; `docs/adr/` for system-wide decisions. See `docs/agents/domain.md`.

### Worktree workflow

Large planning-skill work is built in an isolated worktree → PR, reviewed in the VSCode GitHub Pull Requests extension. One window per task for parallel isolated agents. Invokable via `/worktree-build`. See `docs/agents/worktree-workflow.md`.

## Engineering direction

The north star, to weigh when making changes:

- **Protect the slice contract.** One feature = one package = router + hooks + UI, depending only downward. It's what lets apps mount different subsets — a bespoke client build is a new app importing a different subset, not a fork. Don't leak framework specifics into features; keep them in the app adapter (the honest seam).
- **Keep seams swappable, name what's coupled.** Providers (`@acme/models`), auth (Clerk behind a seam), billing (Stripe) are meant to be replaceable. When something becomes load-bearing or hard to reverse, write it down (ADR) rather than letting it harden silently.
- **Shell/chrome is app-owned.** Framework-specific shell/chrome lives in the app (see `tanstack-start`'s console shell). The compositions layer was removed ([ADR 0011](docs/adr/0011-remove-compositions-layer.md)); shared UI assemblies go in `@acme/ui`. A new `packages/compositions/` entry requires an ADR justifying why the assembly can't live in an app or `@acme/ui`.
- **Earn the next runtime / the next subset.** The portability and subsetting claims are only as true as the apps that prove them. The 2×2 of apps does both: `nextjs`/`tanstack-start` prove the same slices run on two frameworks; the `*-slim` apps prove a no-auth/no-billing _subset_ drops Clerk + Stripe from the graph (ADR 0010). New shared/feature code must stay runtime-agnostic and not re-couple the substrate to auth/billing — design so the next framework or the next reduced subset stays trivial.
- **Documentation keeps pace with design.** `CONTEXT.md` + ADRs are updated _as_ decisions are made (`/grill-with-docs`), not after. Keep the README honest — flag WIP/theoretical, never imply capabilities that don't exist.
