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

> Dev, infra, env, and database commands are manual-only — do not run them.

## Architecture

### Layer boundaries

```
tooling → platform → shared → features → compositions → apps
```

- **tooling**: Shared configs (ESLint, Prettier, TypeScript, Tailwind, Vitest, test-utils). Depends on tooling only.
- **platform**: Runtime substrate — the rails features run on (logger, telemetry, redis, subscriptions, trpc). Depends on platform and tooling.
- **shared**: Reusable primitives (ui, hooks, auth, llamaindex). Depends on shared, platform, and tooling.
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

### LlamaIndex/RAG

`@acme/llamaindex` provides document upload, pgvector storage, and retrieval. Used in compliance and diagram features. OTel spans are created automatically for all tRPC procedures via middleware — use `ctx.telemetry.set()`, `.event()`, `.span()` inside procedures.

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

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical label strings (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout — `CONTEXT-MAP.md` at root points to per-package `CONTEXT.md` files; `docs/adr/` for system-wide decisions. See `docs/agents/domain.md`.

### Worktree workflow

Large planning-skill work is built in an isolated worktree → PR, reviewed in the VSCode GitHub Pull Requests extension. One window per task for parallel isolated agents. Invokable via `/worktree-build`. See `docs/agents/worktree-workflow.md`.
