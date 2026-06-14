# Trellis

> Build RAG apps from composable full-stack feature slices. Import only the features you need; run them on the React framework you want — Next.js, TanStack Start, or plain React. **Framework-agnostic where it counts — the app owns the adapter seam.**

Trellis is an opinionated monorepo template for full-stack RAG apps. It is less a product than a **way of building**: each feature is a self-contained vertical slice, and apps compose the slices they need.

## The big idea

**One feature = one package = router + hooks + UI.** A feature owns its tRPC router, its context, its business-logic hooks, and its components — backend and frontend coupled in a single vertical slice. See [packages/features/chat/](packages/features/chat/).

```
packages/features/chat/src/
├── api/          # tRPC router, context, services  ← backend
├── hooks/        # business logic                  ← the seam
├── components/   # UI                              ← frontend
└── trpc/         # client provider + (optional) server caller
```

Apps don't reach into a feature's internals — they **mount** it: wire the server adapter for its router, render its `TRPCReactProvider`, drop in its components. An app is just a subset of features plus the glue.

**Why this is portable.** The client layer ([chat/src/trpc/react.tsx](packages/features/chat/src/trpc/react.tsx)) is built on [`@trpc/tanstack-react-query`](https://trpc.io/docs/client/tanstack-react-query) + `@tanstack/react-query` with SSE streaming — **no `next` imports**. The server layer is a plain tRPC router. The only framework-specific piece is the *adapter* (how the router is mounted, how the client URL resolves), and that lives in the **app**, not the feature. So the same feature runs under Next.js, TanStack Start, or a bare Express + Vite app.

> "Where it counts": features and shared packages are runtime-agnostic. Compositions (assembled UI) and the adapter wiring are app-specific by design — that's the honest boundary.

## The layered trellis

Dependencies only ever point **down** the layers. Enforced by Turborepo boundary tags (`pnpm boundaries`) — a violation fails the build, not a review comment.

```
tooling  →  platform  →  shared  →  features  →  compositions  →  apps
```

| Layer | May depend on | What lives here |
|-------|---------------|-----------------|
| [tooling/](tooling/) | tooling | Shared configs + test infra: eslint, prettier, typescript, tailwind, vitest, github, test-utils |
| [packages/platform/](packages/platform/) | platform, tooling | Runtime substrate: trpc, subscriptions, logger, redis, telemetry |
| [packages/shared/](packages/shared/) | shared, platform, tooling | Primitives: ui, auth, hooks, llamaindex |
| [packages/features/](packages/features/) | shared, platform, tooling | Vertical domain slices: billing, chat, ingest |
| [packages/compositions/](packages/compositions/) | features, shared, platform, tooling, other compositions | Feature combinations: admin, sidebar |
| [apps/](apps/) | everything | The deployable apps |

## The apps

Three apps, **each adding one hard problem on top of the last** — and each on a different runtime to prove the slices travel. Same packages, different frameworks.

| App | Framework | Adds on top | Status |
|-----|-----------|-------------|--------|
| `express` | Express + Vite (decoupled BE/FE) | the core slice, SSE streaming, **fake providers → zero-config** | 🚧 planned |
| `tanstack-start` | TanStack Start | ingest (doc upload), auth, subscriptions | 🚧 planned |
| [`nextjs`](apps/nextjs/) | Next.js | billing (tiered rate-limiting), admin, sidebar | ✅ live |

`nextjs` (`@acme/nextjs`) is the full reference app today; the other two are the portability proof and land next.

## Quickstart

Requires **Node 22.19.0** ([.nvmrc](.nvmrc)) and **pnpm ≥ 10.15.1**.

```bash
nvm use                      # 22.19.0
npm install -g pnpm@latest-10
pnpm i
```

**Zero-config chat** — the `express` app runs with **fake LLM + embedding providers**: no API keys, no Docker, no `.env`. Clone, install, run, and you have a working RAG chat to read and rip apart.

```bash
pnpm dev                     # fake providers, in-memory — just works
```

**Full stack** — for `tanstack-start` / `nextjs` with real document ingest, auth, and billing:

```bash
pnpm infra:up                # postgres (pgvector), redis, localstack (s3), jaeger
# populate .env  (see "Known rough edges" — committed .env.example is 🚧)
pnpm db:push                 # push schema (confirm prompts)
pnpm dev                     # all apps in watch mode
```

After pulling others' changes, you may need to re-run `pnpm i`, `pnpm db:push`, or `pnpm infra:up` if deps / schema / env changed.

## Project structure

```
trellis/
├── apps/
│   └── nextjs/              # ✅ Next.js app (express, tanstack-start 🚧)
├── packages/
│   ├── platform/           # trpc, subscriptions, logger, redis, telemetry
│   │                       #   (runtime substrate)
│   ├── shared/             # ui, auth, hooks, llamaindex (primitives)
│   ├── features/           # billing, chat, ingest      (vertical slices)
│   └── compositions/       # admin, sidebar             (assembled UI)
├── tooling/                # eslint, prettier, typescript, tailwind, vitest, github, test-utils
├── docs/
│   ├── adr/                # architectural decision records
│   └── agents/             # agent-skill docs
├── CONTEXT-MAP.md          # domain-language index → per-package CONTEXT.md
└── CLAUDE.md               # agent guidance
```

## Tooling & opinions

Everything is centralised so apps and packages stay thin and consistent.

- **Shared configs** — `@acme/eslint-config`, `@acme/prettier-config`, `@acme/tsconfig`, `@acme/tailwind-config`, `@acme/vitest-config`. Packages extend, never redefine.
- **Turborepo** — task graph, caching, and **boundary enforcement** (`pnpm boundaries`).
- **Workspace hygiene** — [sherif](https://github.com/QuiiBz/sherif) (`pnpm lint:ws`) for workspace consistency, [knip](https://knip.dev/) (`pnpm deps:check`) for dead code/deps, syncpack for version alignment.
- **Git hooks** — [lefthook](https://github.com/evilmartians/lefthook), plus gitleaks secret scanning.

### Common commands

```bash
pnpm dev            # all apps, watch mode
pnpm build          # build everything
pnpm typecheck      # type-check all packages
pnpm test           # run Vitest across the monorepo
pnpm lint           # eslint   (lint:fix to autofix)
pnpm format         # prettier (format:fix to autofix)
pnpm boundaries     # verify layer-boundary rules
pnpm lint:ws        # workspace consistency (sherif)
pnpm deps:check     # unused deps/exports (knip)
```

### Adding a package or feature

Always scaffold — never hand-roll a package:

```bash
pnpm turbo gen
```

The generator wires up configs, boundary tags, and the tRPC plumbing for you.

## AI-native

Trellis is built to be navigated by coding agents as much as humans.

- [CONTEXT-MAP.md](CONTEXT-MAP.md) indexes the domain language, pointing to per-package `CONTEXT.md` files.
- [docs/adr/](docs/adr/) records the decisions that are hard to reverse and would otherwise be surprising.
- **Agent skills** live in [docs/agents/](docs/agents/): an [issue tracker](docs/agents/issue-tracker.md) (markdown issues under `.scratch/`), [triage labels](docs/agents/triage-labels.md), and a [worktree workflow](docs/agents/worktree-workflow.md) for building plans in isolation → PR.

See [CLAUDE.md](CLAUDE.md) for the full agent brief.

## Known rough edges

This is a living template — a couple of things are mid-transition. Flagged honestly:

- **Env setup is changing.** The `env:*` scripts pull from a private secret store and are being deprecated — **don't rely on `pnpm env:pull`**. A committed **`.env.example`** is the intended path 🚧 (not landed yet). `pnpm infra:up` itself is solid; use it.
- **LLM + embedding providers are in flux.** Provider config is being made swappable (fake / OpenRouter / Bedrock) via a boot-time toggle. Treat the wiring as moving until it settles; the `fake` path is what powers the zero-config quickstart.
- **S3 / document ingest stays** — backed by localstack in dev (part of `pnpm infra:up`).
