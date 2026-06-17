# Trellis

> Build RAG apps from composable full-stack feature slices. Import only the features you need; run them on the React framework you want — Next.js, TanStack Start, or plain React.

Trellis is an opinionated monorepo template for full-stack RAG apps. It's less a product than a **way of building**: each feature is a self-contained vertical slice, and an app is just a subset of slices plus the glue to mount them.

## The big idea: one feature = one package = router + hooks + UI

A feature owns its tRPC router, its context, its business-logic hooks, and its components — backend and frontend coupled in a single vertical slice. See [packages/features/chat/](packages/features/chat/).

```
packages/features/chat/src/
├── api/          # tRPC router, context, services  ← backend
├── hooks/        # business logic                  ← the seam
├── components/   # UI                              ← frontend
└── trpc/         # client provider + (optional) server caller
```

Three properties fall out of that, and they're the whole point:

1. **Apps mount features, they don't fork them.** An app wires the server adapter for a router, renders its `TRPCReactProvider`, and drops in its components. A bespoke client build — *no billing, no auth*, or an *extra feature* nobody else has — is **a new app importing a different subset**, not a fork. Shared slices stay shared; only the app's dependency list and glue change.

2. **The same slice runs on any React framework.** The client layer is [`@trpc/tanstack-react-query`](https://trpc.io/docs/client/tanstack-react-query) + `@tanstack/react-query` with SSE streaming — **no `next` imports**. The server layer is a plain tRPC router. The only framework-specific piece is the *adapter* (how the router mounts, how the client URL resolves), and it lives in the **app**, not the feature.

3. **The boundaries are enforced, not aspirational.** Dependencies only ever point **down** the layers, checked by Turborepo boundary tags (`pnpm boundaries`) — a violation fails the build, not a review comment.

```
tooling  →  platform  →  shared  →  features  →  compositions  →  apps
```

| Layer | May depend on | What lives here |
|-------|---------------|-----------------|
| [tooling/](tooling/) | tooling | Shared configs + test infra: eslint, prettier, typescript, tailwind, vitest, github, test-utils |
| [packages/platform/](packages/platform/) | platform, tooling | Runtime substrate: trpc, subscriptions, logger, redis, telemetry |
| [packages/shared/](packages/shared/) | shared, platform, tooling | Primitives: ui, auth, hooks, rag, models |
| [packages/features/](packages/features/) | shared, platform, tooling | Vertical domain slices: chat, ingest, billing |
| [packages/compositions/](packages/compositions/) | + features, other compositions | Feature combinations: admin, sidebar |
| [apps/](apps/) | everything | The deployable apps |

> **"Where it counts."** Features and shared packages are runtime-agnostic. Compositions (assembled UI) and adapter wiring are app-specific *by design* — that's the honest boundary, not a leak.

## The apps prove it

The apps run the **same packages on different runtimes** to prove the slices travel, and import **different subsets** to prove they compose.

| App | Framework | Feature subset | Status |
|-----|-----------|----------------|--------|
| [`nextjs`](apps/nextjs/) | Next.js (:3000) | chat · ingest · billing · admin · **sidebar** | ✅ full reference |
| [`tanstack-start`](apps/tanstack-start/) | TanStack Start — Vite + Nitro (:3001) | chat · ingest · billing · admin (app-owned "console shell", no sidebar) | ✅ live, feature parity |
| `express` | Express + Vite (decoupled BE/FE) | core chat slice only | 🚧 planned |

`nextjs` and `tanstack-start` are the portability proof: identical slices under two frameworks with deliberately divergent shells. They already subset in the small (`tanstack-start` drops `sidebar` for an app-owned shell). `express` is the planned reduced-subset example (core only, no auth/billing) — the seams to do it exist; the worked example doesn't yet.

See [**what you get with Trellis**](docs/whats-included.md) for the full feature inventory and an honest map of [what's malleable vs load-bearing](docs/whats-included.md#whats-malleable-vs-load-bearing).

## Every slice speaks one language

A vertical slice is only as decoupled as its **vocabulary**. Every feature ships a [`CONTEXT.md`](packages/features/chat/CONTEXT.md) defining its domain terms — and the synonyms it **refuses** to use: chat owns **Conversation**/**Message**/**Stream** (never "session"); "thread"/"resource" stay quarantined to the Mastra storage layer. That's strategic Domain-Driven Design — bounded contexts with an explicit ubiquitous language — and it pays off: a named term is a context border, so when chat maps a Conversation onto a Mastra `thread` the translation is a written-down anti-corruption seam ([chat.ts](packages/features/chat/src/api/routers/chat.ts#L24)), not a leaked field name. The `_Avoid_` lists let any reviewer flag drift against the doc, and a subsetting app inherits the *meaning*, not just the code. Indexed in [CONTEXT-MAP.md](CONTEXT-MAP.md).

## AI-native

Trellis is built to be navigated and **extended** by coding agents as much as by humans.

- [CONTEXT-MAP.md](CONTEXT-MAP.md) indexes the domain language, pointing to per-package `CONTEXT.md` files; [docs/adr/](docs/adr/) records the decisions that are hard to reverse.
- **The workflow:** `/grill-with-docs` plans a change against the domain language and updates `CONTEXT.md` + ADRs inline → `/worktree-build` builds it in an isolated worktree → PR. The point is **multiple agents in parallel, one window per task**, with a **human making the engineering calls** and reviewing every PR — agents never auto-merge.

Full agent brief in [CLAUDE.md](CLAUDE.md); workflow details in [docs/agents/](docs/agents/).

## Quickstart

Requires **Node 22.19.0** ([.nvmrc](.nvmrc)), **pnpm ≥ 10.15.1**, and **Docker** for local infra. **No cloud credentials needed** — the default provider is **Ollama** (local, CPU-only), billing runs on `localstripe`, S3 on LocalStack. You bring Docker; you don't bring accounts.

```bash
nvm use                      # 22.19.0
npm install -g pnpm@latest-10
pnpm i                       # installs + builds packages + sets up git hooks
pnpm infra:up                # Docker: postgres+pgvector, redis, localstack(s3), localstripe, jaeger, ollama
cp .env.example .env         # non-secret local-dev defaults work as-is
pnpm db:push                 # push schema (confirm prompts)
pnpm dev                     # nextjs :3000, tanstack-start :3001
```

For the full walkthrough (install → infra → env → db → run → verify), every script, and the development flow, see [**Getting started**](docs/getting-started.md) and [**DX & tooling**](docs/whats-included.md#dx--developer-experience).

## Tooling & opinions

Everything is centralised so apps and packages stay thin. Shared configs (`@acme/eslint-config`, `@acme/tsconfig`, `@acme/tailwind-config`, …) are extended, never redefined. Turborepo handles the task graph, caching, and boundary enforcement. Workspace hygiene is [sherif](https://github.com/QuiiBz/sherif) (`pnpm lint:ws`) + [knip](https://knip.dev/) (`pnpm deps:check`); git hooks are [lefthook](https://github.com/evilmartians/lefthook) with gitleaks secret scanning.

Always scaffold packages — never hand-roll them — so configs, boundary tags, and tRPC plumbing get wired for you:

```bash
pnpm turbo gen
```

## Known rough edges

A living template — a few things are mid-transition, flagged honestly:

- **Clerk is a hard dependency for both apps.** The *framework* is abstracted behind the auth seam ([ADR 0003](docs/adr/0003-framework-agnostic-auth-seam.md)) — apps resolve auth and inject it into the tRPC context, so the server side is already swappable. But the *provider* isn't: `@acme/auth` re-exports `@clerk/clerk-react` hooks/components that features import directly (e.g. `UserButton`, billing's `useAuth`), and `ctx.user` is a backend Clerk `User`. So today you can't run `nextjs`/`tanstack-start` without Clerk env. The planned `express` app sidesteps it (core chat only, no auth); fully decoupling the provider from the existing apps is a known pain point we may revisit.
- **Billing is swappable but not yet exercised by a no-billing app.** Billing is injected the same way auth is: the platform substrate depends only on the neutral `@acme/entitlements` contract, and the app injects a concrete `EntitlementsProvider` — the Stripe/Redis-backed `subscriptionsEntitlements`, or `unlimitedEntitlements` for a no-billing build ([ADR 0006](docs/adr/0006-entitlements-injection-seam.md)). chat and ingest no longer drag in Stripe or Clerk. The existing apps still wire the Stripe adapter; the no-billing subset (inject `unlimitedEntitlements` + a constant principal, mount chat + ingest) isn't a shipped app yet.
- **No zero-Docker path yet.** Full-stack local dev needs `pnpm infra:up`. The planned `express` app (core chat only) is the intended lighter-weight entry point — not built yet.
- **`SECRET_MAP` only maps `nextjs`.** Secrets sync against a pluggable backend ([ADR 0001](docs/adr/0001-pluggable-secrets-sync.md); default `dotenv-file`, zero setup), but `tanstack-start` still needs adding to `secrets.config.sh`.
- **Model providers are settling.** Selection lives in [`@acme/models`](packages/shared/models/CONTEXT.md) — `bedrock` / `openrouter` / `ollama` by env ([ADR 0003](docs/adr/0003-multi-provider-models.md)). Ollama is the default so the repo runs with no credentials; dev models are tiny/CPU-only, not production quality.
- **The compositions layer is being wound down.** Direction is app-owned shells (see `tanstack-start`); compositions reserved for genuine cross-app DRY.

## Documentation

Full index — [**docs/**](docs/). High-traffic:

- [Getting started](docs/getting-started.md) — step-by-step first run.
- [What you get with Trellis](docs/whats-included.md) — features, tooling, command reference, malleable vs load-bearing.
- [Agent workflow](docs/agents/) · [Architectural decisions](docs/adr/) · [CONTEXT-MAP](CONTEXT-MAP.md) · [Testing guide](docs/TESTING.md).
