# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Navigation protocol — read before you search or edit

Consult the map before grepping; it turns most searches into a direct jump.

1. **Locating code in a feature/package?** Don't grep first. Read its
   [CONTEXT-MAP.md](CONTEXT-MAP.md) row → the package's `CONTEXT.md`, then
   [docs/agents/feature-anatomy.md](docs/agents/feature-anatomy.md) for the exact
   layout (`api/routers/*`, `hooks/use-*`, `api/schemas/*`). Jump to the file.
2. **Hunting a symbol across packages?** Split by operation. `LSP` `hover` /
   `workspaceSymbol` / `documentSymbol` and _same-package_ `goToDefinition` /
   `findReferences` are reliable — use them. But **cross-package**
   `goToDefinition` / `findReferences` are NOT reliable here: packages consume
   each other through the `dist/*.d.ts` barrel (exports `types` → `dist`), so
   tsserver can't link a source symbol to consumers in other packages
   (`references` doesn't fix it — TS treats this as working-as-intended, and the
   only fix trades away the fast dist-based build). For cross-package reference
   hunting, use ripgrep scoped to `packages/`/`apps/`, or the `Explore` subagent.
3. **Broad / cross-layer search** (a seam wired app→feature→platform; all callers
   of X): delegate to the `Explore` subagent so the fan-out stays out of this
   context. Single greps and known-location lookups stay inline.
4. **Before calling a change done:** `pnpm turbo run lint typecheck -F @acme/<pkg>`
   (cached, seconds — catches boundaries/exports/`as`/`useEffect`). Then
   `pnpm tidy` (auto-fix) and `pnpm quality-gate` (read-only verify) once at end
   of task (ADR 0020).

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
pnpm tidy                # Auto-fix: lint:fix + format:fix (run before the gate)
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
pnpm tidy                # Auto-fix first (lint:fix + format:fix) — the gate is read-only
pnpm quality-gate        # READ-ONLY verify, parallel: turbo(lint+format+typecheck+build+test) + check:exports + boundaries + lint:ws + deps:lint + test:policy + gitleaks
```

How and when to run these — incremental per-package checks and the end-of-task
gate — is [docs/agents/quality-gate.md](docs/agents/quality-gate.md); the rationale is [ADR 0020](docs/adr/0020-commit-tidies-gate-verifies.md).

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

### Redis

All keys must be created via `nsKey(key)` from `@acme/redis` — produces a branded `NamespacedKey` type; passing a raw `string` is a compile error. Key builders (e.g. `creditKey`) live in domain packages, not in `@acme/redis`. Namespace is derived from `NEXT_PUBLIC_WEBAPP`.

### Database

All app-owned tables live under `pgSchema(NEXT_PUBLIC_WEBAPP)` — per-app Postgres schema isolation. `@acme/db` exports the sole connection factory (`createDb()`); features import it rather than declaring their own DB env. Migrations are app-owned (`db:push` / `db:migrate` run from the app, not the platform).

### Feature package structure

See [docs/agents/feature-anatomy.md](docs/agents/feature-anatomy.md).

### Package exports convention

Every runtime package (`packages/platform|shared|features`) has a
`package.json` `exports` map following a bounded, concern-driven convention,
enforced by `scripts/check-exports.mjs` (hard-fails `pnpm lint`).
`tooling/*` config packages are out of scope. See
[ADR 0015](docs/adr/0015-package-exports-convention.md).

## Development Patterns

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

See `docs/agents/issue-tracker.md`.

### Triage labels

See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout — `CONTEXT-MAP.md` at root points to per-package `CONTEXT.md` files; `docs/adr/` for system-wide decisions. See `docs/agents/domain.md`.

### Worktree workflow

See `docs/agents/worktree-workflow.md`.

## Engineering direction

The north star, to weigh when making changes:

- **Protect the slice contract.** One feature = one package = router + hooks + UI, depending only downward. It's what lets apps mount different subsets — a bespoke client build is a new app importing a different subset, not a fork. Don't leak framework specifics into features; keep them in the app adapter (the honest seam).
- **Keep seams swappable, name what's coupled.** Providers (`@acme/models`), auth (Clerk behind a seam), billing (Stripe) are meant to be replaceable. When something becomes load-bearing or hard to reverse, write it down (ADR) rather than letting it harden silently.
- **Shell/chrome is app-owned.** Framework-specific shell/chrome lives in the app (see `tanstack-start`'s console shell). The compositions layer was removed ([ADR 0011](docs/adr/0011-remove-compositions-layer.md)); shared UI assemblies go in `@acme/ui`. A new `packages/compositions/` entry requires an ADR justifying why the assembly can't live in an app or `@acme/ui`.
- **Earn the next runtime / the next subset.** The portability and subsetting claims are only as true as the apps that prove them. The 2×2 of apps does both: `nextjs`/`tanstack-start` prove the same slices run on two frameworks; the `*-slim` apps prove a no-auth/no-billing _subset_ drops Clerk + Stripe from the graph (ADR 0010). New shared/feature code must stay runtime-agnostic and not re-couple the substrate to auth/billing — design so the next framework or the next reduced subset stays trivial.
- **Documentation keeps pace with design.** `CONTEXT.md` + ADRs are updated _as_ decisions are made (`/grill-with-docs`), not after. Keep the README honest — flag WIP/theoretical, never imply capabilities that don't exist.
