# Trellis

> Build RAG apps from composable full-stack feature slices. Import only the features you need; run them on the React framework you want — Next.js or TanStack Start.

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
tooling  →  platform  →  shared  →  features  →  apps
```

| Layer | May depend on | What lives here |
|-------|---------------|-----------------|
| [tooling/](tooling/) | tooling | Shared configs + test infra: eslint, prettier, typescript, tailwind, vitest, github, test-utils |
| [packages/platform/](packages/platform/) | platform, tooling | Runtime substrate: trpc, subscriptions, entitlements, logger, redis, telemetry |
| [packages/shared/](packages/shared/) | shared, platform, tooling | Primitives: ui, auth, hooks, rag, models |
| [packages/features/](packages/features/) | shared, platform, tooling | Vertical domain slices: chat, ingest, billing, feedback |
| [apps/](apps/) | everything | The deployable apps (own their shell/chrome) |

> **"Where it counts."** Features and shared packages are runtime-agnostic. Assembled UI (shell/chrome) and adapter wiring are app-owned *by design* — that's the honest boundary, not a leak ([ADR 0011](docs/adr/0011-remove-compositions-layer.md)).

## The apps prove it — two axes, four apps

The claim is two-dimensional: the same slices **travel across runtimes** *and* **compose into different subsets**. So the apps are a 2×2 — pick a framework (column), pick a subset (row), the feature slices underneath are byte-for-byte the same packages:

| | **Next.js** | **TanStack Start** (Vite + Nitro) |
|---|---|---|
| **Full** — chat · ingest · billing · admin | [`nextjs`](apps/nextjs/) :3000 — full reference (+ `sidebar`) | [`tanstack-start`](apps/tanstack-start/) :3001 — app-owned console shell |
| **Slim** — chat · ingest, *no auth, no billing* | [`nextjs-slim`](apps/nextjs-slim/) :3002 | [`tanstack-slim`](apps/tanstack-slim/) :3003 |

- **Columns prove portability.** Identical slices under two frameworks with deliberately divergent shells — the only per-app code is the adapter (route handler + client URL + auth-context resolver).
- **Rows prove subsetting.** The slim apps **drop Clerk and Stripe entirely** — they don't depend on `@acme/auth`, `@acme/billing`, or `@acme/subscriptions`, and inject a constant local principal + `unlimitedEntitlements` instead ([ADR 0010](docs/adr/0010-slim-no-auth-apps.md)). A no-auth/no-billing product is *a different subset of the same packages*, not a fork — and the build enforces it (the dependency graph literally doesn't contain Clerk/Stripe for a slim app).

That row is only possible because billing and auth are **injected, not imported**: the platform substrate depends on neutral contracts, and the app chooses the implementation ([auth seam ADR 0003](docs/adr/0003-framework-agnostic-auth-seam.md), [entitlements seam ADR 0006](docs/adr/0006-entitlements-injection-seam.md)).

See [**what you get with Trellis**](docs/whats-included.md) for the full feature inventory and [what's malleable vs load-bearing](docs/whats-included.md#whats-malleable-vs-load-bearing).

## Every slice speaks one language

A vertical slice is only as decoupled as its **vocabulary**. Every feature ships a [`CONTEXT.md`](packages/features/chat/CONTEXT.md) defining its domain terms — and the synonyms it **refuses** to use: chat owns **Conversation**/**Message**/**Stream** (never "session"); "thread"/"resource" stay quarantined to the Mastra storage layer. That's strategic Domain-Driven Design — bounded contexts with an explicit ubiquitous language — and it pays off: a named term is a context border, so when chat maps a Conversation onto a Mastra `thread` the translation is a written-down anti-corruption seam ([chat.ts](packages/features/chat/src/api/routers/chat.ts#L24)), not a leaked field name. The `_Avoid_` lists let any reviewer flag drift against the doc, and a subsetting app inherits the *meaning*, not just the code. Indexed in [CONTEXT-MAP.md](CONTEXT-MAP.md).

## The tooling earns the claims

The architecture is only as honest as the tooling that keeps it that way. A few that do real work:

- **Eject any app into a standalone repo.** `pnpm prune @acme/tanstack-start` runs `turbo prune` + a config overlay to emit a **self-contained single-app repo** under `out/` that installs and builds on its own (`pnpm install`) — no monorepo required ([scripts/extract-app.sh](scripts/extract-app.sh)). The slice contract means an app *is* extractable; this proves it.
- **Dev infra derived from the dependency graph.** `pnpm dev [app]` starts only the Docker services its targets actually need — the **union of `acme.infra` over each app's transitive package closure**, waits for them healthy, pushes schema, then runs the dev servers. There's no `core` always-on set: a slim app that doesn't depend on `@acme/billing` derives no Stripe container *because the graph says so*, not because anyone maintained a list ([ADR 0009](docs/adr/0009-graph-derived-dev-infra.md)).
- **A test gate you can trust.** Every package declares a `testClass` capability in `package.json`; `pnpm test:policy` (in `quality-gate`) asserts each one ships the tests it owes, and tracked gaps are explicit `testStatus: "todo"` — so a green `pnpm test` means "coverage intent satisfied", not "the packages that happen to have tests passed" ([ADR 0007](docs/adr/0007-package-test-policy.md)).
- **One identity partitions every shared datastore.** A single `NEXT_PUBLIC_WEBAPP` value namespaces each app's Postgres schema *and* its Redis keyspace (the latter via an invisible client `Proxy`), so the four apps share one Postgres + one Redis without clobbering each other — fail-loud if unset ([ADR 0008](docs/adr/0008-per-app-redis-namespace.md)).
- **One composite gate.** `pnpm quality-gate` runs lint → format → typecheck → build → boundaries → test-policy → workspace-lint → dep-lint → gitleaks → test → audit. The same checks CI runs.

More in [**DX & tooling**](docs/whats-included.md#dx--developer-experience).

## AI-native

Trellis is built to be navigated and **extended** by coding agents as much as by humans.

- [CONTEXT-MAP.md](CONTEXT-MAP.md) indexes the domain language, pointing to per-package `CONTEXT.md` files; [docs/adr/](docs/adr/) records the decisions that are hard to reverse.
- **The workflow:** `/grill-with-docs` plans a change against the domain language and updates `CONTEXT.md` + ADRs inline → `/worktree-build` builds it in an isolated worktree → PR. The point is **multiple agents in parallel, one window per task**, with a **human making the engineering calls** and reviewing every PR — agents never auto-merge.

Full agent brief in [CLAUDE.md](CLAUDE.md); workflow details in [docs/agents/](docs/agents/).

## Quickstart

Requires **Node 22.19.0** ([.nvmrc](.nvmrc)), **pnpm ≥ 10.15.1**, and **Docker** for local infra. **No cloud credentials needed** — the default provider is **Ollama** (local, CPU-only), billing runs on `localstripe`, S3 on LocalStack.

```bash
nvm use                      # 22.19.0
npm install -g pnpm@latest-10
pnpm i                       # installs + builds packages + sets up git hooks
cp .env.example .env         # non-secret local-dev defaults work as-is
pnpm dev                     # starts only the infra each app needs, then the dev servers
```

`pnpm dev` is graph-aware: it brings up the Docker services your target apps need, waits for health, pushes the schema, and runs the servers. The full apps need [Clerk](https://clerk.com) keys; the **slim apps need no auth or billing credentials at all**.

Step-by-step (install → infra → env → db → run → verify) in [**Getting started**](docs/getting-started.md). Every script in [**DX & tooling**](docs/whats-included.md#dx--developer-experience).

## Known rough edges

A living template — a few things are mid-transition, flagged honestly:

- **Clerk is a hard dependency for the *full* apps.** The *framework* is abstracted behind the auth seam ([ADR 0003](docs/adr/0003-framework-agnostic-auth-seam.md)), but the *provider* isn't: `@acme/auth` re-exports `@clerk/clerk-react` hooks/components that features import directly (e.g. `UserButton`, billing's `useAuth`), and `ctx.user` is a backend Clerk `User`. So `nextjs`/`tanstack-start` need Clerk env. The **slim apps sidestep it entirely** (no `@acme/auth`, constant local principal) — fully decoupling the provider from the *full* apps is the remaining work.
- **No zero-Docker path.** Even the slim apps need `pnpm infra:up` — they keep chat + ingest, which need Postgres + pgvector (Mastra) and Ollama. The graph-derived `pnpm dev` starts *less* for a slim app (no Stripe, no Redis), but not *nothing*.
- **`SECRET_MAP` only maps `nextjs`.** Secrets sync against a pluggable backend ([ADR 0001](docs/adr/0001-pluggable-secrets-sync.md); opt-in via `SECRETS_BACKEND`, `localstack` for dev or `aws` for a real vault), but the other apps still need adding to `secrets.config.sh`.
- **Model providers are settling.** Selection lives in [`@acme/models`](packages/shared/models/CONTEXT.md) — `bedrock` / `openrouter` / `ollama` by env ([ADR 0003](docs/adr/0003-multi-provider-models.md)). Ollama is the default so the repo runs with no credentials; dev models are tiny/CPU-only, not production quality.
- **The compositions layer was removed.** Shell/chrome is app-owned ([ADR 0011](docs/adr/0011-remove-compositions-layer.md)); shared UI assemblies belong in `@acme/ui`, not a new composition.

## Documentation

Full index — [**docs/**](docs/). High-traffic:

- [Getting started](docs/getting-started.md) — step-by-step first run.
- [What you get with Trellis](docs/whats-included.md) — features, tooling, command reference, malleable vs load-bearing.
- [Agent workflow](docs/agents/) · [Architectural decisions](docs/adr/) · [CONTEXT-MAP](CONTEXT-MAP.md) · [Testing guide](docs/TESTING.md).
</content>
</invoke>
