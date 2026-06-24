# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trellis is a Turborepo monorepo RAG starter. The architecture enforces strict boundaries between layers using turbo.json and pnpm workspace configuration.

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
turbo run test -F <pkg>  # Run tests for a single package
```

### Dependencies
```bash
pnpm deps:check          # Check for unused dependencies with knip
```

> In a git worktree, dev/infra/env/database commands are manual-only — do not run them. On the primary checkout (e.g. `main`) you may run them to test.

## Architecture

### Layer boundaries

```
tooling → platform → shared → features → compositions → apps
```

- **tooling**: Shared configs (ESLint, Prettier, TypeScript, Tailwind, Vitest, test-utils). Depends on tooling only.
- **platform**: Runtime substrate — the rails features run on (logger, telemetry, redis, subscriptions, trpc). Depends on platform and tooling.
- **shared**: Reusable primitives (ui, hooks, auth, rag). Depends on shared, platform, and tooling.
- **features**: Domain modules. Depends on shared, platform, and tooling only.
- **compositions**: Feature combinations. Depends on features, shared, platform, tooling, other compositions.
- **apps**: Applications. Depends on all layers.

### tRPC Architecture (v11)

Each feature defines its own router in `src/api/root.ts` and tRPC context in `src/api/trpc.ts` (includes Clerk auth, db clients, billing tier, Redis, OTel).

Features export `TRPCReactProvider` from `src/trpc/react.tsx`, routing to `/api/trpc/<feature-name>`. Apps wire the Next.js handler at `src/app/api/trpc/<feature-name>/[trpc]/route.ts`.

**Usage patterns**:
```typescript
// Client: use useTRPC() from feature's trpc/react.tsx
const trpc = useTRPC();
const query = useQuery(trpc.jobs.list.queryOptions(input, options));
const mutation = useMutation(trpc.jobs.create.mutationOptions(options));
const subscription = useSubscription(trpc.chat.stream.subscriptionOptions(input));
```

**Key principles**:
- Business logic in `src/hooks/` within feature packages
- Components UI-focused only — don't call tRPC directly from components
- Server-side: import from `src/trpc/server.tsx` for direct tRPC calls

### Rate Limiting

```typescript
.use(rateLimit({ tokens: 5 })) // Consumes tokens per request
```

Tokens are tier-based (free/standard/pro) stored in Redis. Available via tRPC middleware.

### RAG / Mastra

`@acme/rag` provides document upload (officeparser), pgvector storage, retrieval, and Mastra Memory — all on Mastra wired to AWS Bedrock. Used by the chat and ingest features. The chat Agent + Mastra instance live in `@acme/chat`; the root `pnpm studio` / `pnpm lint:mastra` scripts point the Mastra CLI at `packages/features/chat/src/mastra`. See [`docs/adr/0002-mastra-rag-and-memory.md`](docs/adr/0002-mastra-rag-and-memory.md). OTel spans are created automatically for all tRPC procedures via middleware — use `ctx.telemetry.set()`, `.event()`, `.span()` inside procedures.

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
- **Prefer app-owned over composition.** Framework-specific shell/chrome lives in the app (see `tanstack-start`'s console shell); reserve `packages/compositions/` for genuine cross-app DRY. The compositions layer is being wound down — don't grow it by default.
- **Earn the next runtime.** The portability claim is only as true as the apps that prove it. New shared/feature code must stay runtime-agnostic; the planned `express` app (core-only, lighter-weight) is the test of the reduced-subset case — design toward making it trivial.
- **Documentation keeps pace with design.** `CONTEXT.md` + ADRs are updated *as* decisions are made (`/grill-with-docs`), not after. Keep the README honest — flag WIP/theoretical, never imply capabilities that don't exist.
