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

### Why slices: one template, many apps

The reason features are self-contained slices is so that **different apps can mount different subsets** of them. This was the founding motivation: if a client wants a bespoke build — *no billing, no Stripe, no auth* — or conversely an *extra feature* nobody else has, that build is **a new app importing a different subset**, not a fork of the codebase. The shared slices stay shared; only the app's dependency list and glue change.

Today this is **architecturally true and partly proven — flagged honestly**:

- ✅ **Portability is proven.** `nextjs` and `tanstack-start` mount the same slices through different framework adapters and different shells — same business logic, two runtimes.
- ✅ **Subsetting already happens in the small.** The two live apps import *different* sets (`tanstack-start` drops the `sidebar` composition for an app-owned shell).
- 🚧 **The reduced-client-app case is still illustrative.** No app yet ships a deliberately stripped subset (e.g. chat-only, no auth/billing). The planned `express` app is the intended minimal example — the seams to do it exist, the worked example doesn't yet.

See [**what you get with Trellis**](docs/whats-included.md) for the full feature inventory and an honest map of [what's malleable vs load-bearing](docs/whats-included.md#whats-malleable-vs-load-bearing).

## The layered trellis

Dependencies only ever point **down** the layers. Enforced by Turborepo boundary tags (`pnpm boundaries`) — a violation fails the build, not a review comment.

```
tooling  →  platform  →  shared  →  features  →  compositions  →  apps
```

| Layer | May depend on | What lives here |
|-------|---------------|-----------------|
| [tooling/](tooling/) | tooling | Shared configs + test infra: eslint, prettier, typescript, tailwind, vitest, github, test-utils |
| [packages/platform/](packages/platform/) | platform, tooling | Runtime substrate: trpc, subscriptions, logger, redis, telemetry |
| [packages/shared/](packages/shared/) | shared, platform, tooling | Primitives: ui, auth, hooks, rag |
| [packages/features/](packages/features/) | shared, platform, tooling | Vertical domain slices: billing, chat, ingest |
| [packages/compositions/](packages/compositions/) | features, shared, platform, tooling, other compositions | Feature combinations: admin, sidebar |
| [apps/](apps/) | everything | The deployable apps |

## The apps

The apps run the **same packages on different runtimes** to prove the slices travel, and import **different subsets** to prove they compose.

| App | Framework | Feature subset | Status |
|-----|-----------|----------------|--------|
| [`nextjs`](apps/nextjs/) | Next.js (:3000) | chat · ingest · billing · admin · **sidebar** | ✅ full reference |
| [`tanstack-start`](apps/tanstack-start/) | TanStack Start — Vite + Nitro (:3001) | chat · ingest · billing · admin (app-owned "console shell", no sidebar) | ✅ live, feature parity |
| `express` | Express + Vite (decoupled BE/FE) | core chat slice only — the minimal-subset proof | 🚧 planned |

`nextjs` and `tanstack-start` are both live and at feature parity — the portability proof, same slices under two frameworks with deliberately divergent shells. `express` is the planned reduced-subset example (core only, no auth/billing/ingest).

## Quickstart

> The condensed version is below. For the full step-by-step walkthrough (install → infra → env → db → run → verify), see [**Getting started**](docs/getting-started.md).

Requires **Node 22.19.0** ([.nvmrc](.nvmrc)) and **pnpm ≥ 10.15.1**, plus **Docker** for local infra.

```bash
nvm use                      # 22.19.0
npm install -g pnpm@latest-10
pnpm i                       # installs + builds packages + sets up git hooks
```

**No cloud credentials needed.** The default model provider is **Ollama** (local, CPU-only), so chat + embeddings run without any API keys. Billing runs against `localstripe` and S3 against LocalStack — both local. You bring Docker; you don't bring accounts.

```bash
pnpm infra:up                # Docker: postgres+pgvector, redis, localstack(s3), localstripe, jaeger, ollama
cp .env.example .env         # local-dev defaults are non-secret and work as-is
pnpm db:push                 # push schema (confirm prompts)
pnpm dev                     # all apps in watch mode — nextjs :3000, tanstack-start :3001
```

After pulling others' changes, re-run `pnpm i`, `pnpm db:push`, or `pnpm infra:up` if deps / schema / infra changed.

> 🚧 A truly zero-Docker quickstart (the planned `express` app, core chat only) doesn't exist yet — today, `pnpm infra:up` is the path. See the full [command reference and development flow](docs/whats-included.md#dx--developer-experience).

## Project structure

```
trellis/
├── apps/
│   └── nextjs/              # ✅ Next.js app (express, tanstack-start 🚧)
├── packages/
│   ├── platform/           # trpc, subscriptions, logger, redis, telemetry
│   │                       #   (runtime substrate)
│   ├── shared/             # ui, auth, hooks, rag, models (primitives)
│   ├── features/           # chat, ingest, billing      (vertical slices)
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

> The above is the short list. For **every** script, the intended setup-and-develop flow, and the full tooling inventory, see [what you get with Trellis → DX](docs/whats-included.md#dx--developer-experience).

## AI-native

Trellis is built to be navigated — and **extended** — by coding agents as much as by humans.

- [CONTEXT-MAP.md](CONTEXT-MAP.md) indexes the domain language, pointing to per-package `CONTEXT.md` files.
- [docs/adr/](docs/adr/) records the decisions that are hard to reverse and would otherwise be surprising.
- **The agent workflow** is a `/grill-with-docs` planning pass (stress-test the plan against the domain language, update `CONTEXT.md` + ADRs inline) → `/worktree-build` to build it in an isolated worktree → PR. The point is running **multiple agents in parallel, one window per task, isolated in their own worktrees**, with a **human making the engineering calls** and reviewing every PR — agents never auto-merge. Full overview in [docs/agents/](docs/agents/) (issue tracker, triage labels, worktree workflow, domain docs).

See [CLAUDE.md](CLAUDE.md) for the full agent brief.

## Documentation

Full contents index — [**docs/**](docs/). The high-traffic ones:

- [Getting started](docs/getting-started.md) — step-by-step first run.
- [What you get with Trellis](docs/whats-included.md) — features, tooling, command reference, malleable vs load-bearing.
- [Agent workflow](docs/agents/) — planning + parallel isolated build agents.
- [Architectural decisions](docs/adr/) · [CONTEXT-MAP](CONTEXT-MAP.md) · [Testing guide](docs/TESTING.md).

## Known rough edges

This is a living template — a few things are mid-transition. Flagged honestly:

- **Env setup.** `.env.example` is committed — `cp .env.example .env` and the non-secret local-dev defaults work as-is. For secrets, `pnpm env:pull` / `env:push` sync against a pluggable backend ([ADR 0001](docs/adr/0001-pluggable-secrets-sync.md); default `dotenv-file`, zero setup). 🚧 The `SECRET_MAP` in `secrets.config.sh` still only maps the `nextjs` app — `tanstack-start` needs adding.
- **Model providers are settling.** Provider selection lives in [`@acme/models`](packages/shared/models/CONTEXT.md) — `bedrock` / `openrouter` / `ollama`, chosen by env ([ADR 0003](docs/adr/0003-multi-provider-models.md)). **Ollama is the default** so the repo runs with no cloud credentials; the dev models are tiny/CPU-only, not production quality. (There is **no "fake" provider** — earlier drafts of this README implied one.)
- **No zero-Docker path yet.** Full-stack local dev needs `pnpm infra:up`. The planned `express` app (core chat only) is the intended minimal, lighter-weight entry point — not built yet.
- **The compositions layer is being reconsidered.** Direction is app-owned shells (see `tanstack-start`); compositions reserved for genuine cross-app DRY. See [what's malleable vs load-bearing](docs/whats-included.md#whats-malleable-vs-load-bearing).
- **S3 / document ingest stays** — backed by LocalStack in dev (part of `pnpm infra:up`).
