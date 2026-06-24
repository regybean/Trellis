# What you get with Trellis

A tour of everything wired up in this template today — features, shared primitives, the platform substrate, and the DX/tooling — followed by an honest map of [what's malleable vs load-bearing](#whats-malleable-vs-load-bearing).

Each entry links to its package `CONTEXT.md` (the domain-language source of truth). The index of all of them is [CONTEXT-MAP.md](../CONTEXT-MAP.md).

Status key: ✅ wired & runnable · 🟡 evolving · 🚧 planned / not built yet.

---

## Apps — what's actually wired up

The four apps form a 2×2: framework (column) × feature subset (row). The slices underneath are the same packages — see [the apps prove it](../README.md#the-apps-prove-it--two-axes-four-apps).

| App | Framework | Feature subset it mounts | Status |
|-----|-----------|--------------------------|--------|
| [`nextjs`](../apps/nextjs/CONTEXT.md) | Next.js (:3000) | chat · ingest · billing · admin · **sidebar** | ✅ full reference |
| [`tanstack-start`](../apps/tanstack-start/CONTEXT.md) | TanStack Start — Vite + Nitro (:3001) | chat · ingest · billing · admin (app-owned "console shell", no sidebar) | ✅ live, feature parity |
| [`nextjs-slim`](../apps/nextjs-slim/CONTEXT.md) | Next.js (:3002) | chat · ingest — **no auth, no billing** | ✅ |
| [`tanstack-slim`](../apps/tanstack-slim/CONTEXT.md) | TanStack Start (:3003) | chat · ingest — **no auth, no billing** (app-owned console shell) | ✅ |

The **columns** prove portability — the same slices under two frameworks, differing only in the per-app adapter. The **rows** prove subsetting — the slim apps drop Clerk and Stripe *from the dependency graph* (no `@acme/auth`, `@acme/billing`, `@acme/subscriptions`, `@acme/admin`), injecting a constant local principal + `unlimitedEntitlements` instead ([ADR 0010](adr/0010-slim-no-auth-apps.md)). A no-auth/no-billing product is a *different subset of the same packages*, not a fork.

---

## Features — vertical domain slices

`packages/features/` · each is router + hooks + UI in one package. Depend on shared, platform, tooling only.

| Feature | What it does | Status |
|---------|--------------|--------|
| [`@acme/chat`](../packages/features/chat/CONTEXT.md) | LLM chat: SSE streaming, persistent conversation history, RAG over the knowledge base. The Mastra agent + Mastra instance live here. | ✅ |
| [`@acme/ingest`](../packages/features/ingest/CONTEXT.md) | Admin-only knowledge-base management: upload `.pdf` / `.docx` / `.txt`, parsed and indexed into the vector store. | ✅ |
| [`@acme/billing`](../packages/features/billing/CONTEXT.md) | Stripe-backed subscriptions (Basic / Standard / Pro), credit-based rate limiting, checkout, billing portal, admin credit tools. Runs against [`localstripe`](../docs/adr/0004-localstripe-dev-billing.md) in dev — no Stripe account needed. | ✅ |

## Shared — reusable primitives

`packages/shared/` · depend on shared, platform, tooling.

| Package | What it does | Status |
|---------|--------------|--------|
| [`@acme/ui`](../packages/shared/ui/) | Shared component library (shadcn-style). Add components with `pnpm ui-add`. | ✅ |
| [`@acme/auth`](../packages/shared/auth/) | Clerk-based auth behind a **framework-agnostic seam** — the app resolves the request into context, the feature never imports framework auth. See [ADR 0003 (auth seam)](adr/0003-framework-agnostic-auth-seam.md). | ✅ |
| [`@acme/hooks`](../packages/shared/hooks/) | Shared React hooks. | ✅ |
| [`@acme/rag`](../packages/shared/rag/CONTEXT.md) | RAG + conversation memory on [Mastra](adr/0002-mastra-rag-and-memory.md): vector store, document uploader, memory storage. Provider-agnostic — models come from `@acme/models`. | ✅ |
| [`@acme/models`](../packages/shared/models/CONTEXT.md) | Resolves chat + embed AI-SDK models from an env-selected provider (`bedrock` / `openrouter` / `ollama`). **Ollama is the default, so the repo runs with no cloud credentials.** See [ADR 0003 (multi-provider)](adr/0003-multi-provider-models.md). | ✅ |

## Platform — the runtime substrate

`packages/platform/` · the rails features run on. Depend on platform, tooling.

| Package | What it does | Status |
|---------|--------------|--------|
| [`@acme/trpc`](../packages/platform/trpc/CONTEXT.md) | The single tRPC init + request-pipeline middleware every feature reuses: auth, OTel tracing, timing, rate limiting. Owns *how* a request is handled, not *what*. | ✅ |
| [`@acme/subscriptions`](../packages/platform/subscriptions/CONTEXT.md) | Server-only. Single source of truth for reading Subscription + Credit state from Redis (what `@acme/billing` syncs). | ✅ |
| [`@acme/telemetry`](../packages/platform/telemetry/) | OpenTelemetry. Spans auto-created per tRPC procedure; `ctx.telemetry.set()/.event()/.span()` inside procedures. Exports to Jaeger in dev. | ✅ |
| [`@acme/logger`](../packages/platform/logger/) | Structured logging. | ✅ |
| [`@acme/redis`](../packages/platform/redis/) | Shared Redis client (rate-limit tokens, subscription cache). | ✅ |

## Compositions — assembled UI

`packages/compositions/` · feature combinations.

| Package | What it does | Status |
|---------|--------------|--------|
| [`@acme/admin`](../packages/compositions/admin/CONTEXT.md) | Server composition assembling the admin dashboard from `@acme/billing` + `@acme/ingest` + Clerk roles. | ✅ |
| [`@acme/sidebar`](../packages/compositions/sidebar/CONTEXT.md) | Reusable collapsible sidebar nav shell. Used by `nextjs`; `tanstack-start` deliberately uses its own app-owned shell instead. | 🟡 |

> 🟡 **The compositions layer is being reconsidered.** The working direction is that framework-specific shell/chrome lives in the **app** (as `tanstack-start`'s console shell does), and compositions are reserved for genuine cross-app DRY. Treat `sidebar` as illustrative rather than a rule to follow.

## Tooling — shared configs & test infra

`tooling/` · depend on tooling only. Packages extend these, never redefine.

| Package | What it is |
|---------|-----------|
| [`@acme/eslint-config`](../tooling/eslint/) | ESLint config |
| [`@acme/prettier-config`](../tooling/prettier/) | Prettier config |
| [`@acme/tsconfig`](../tooling/typescript/) | Base TypeScript configs |
| [`@acme/tailwind-config`](../tooling/tailwind/) | Tailwind config |
| [`@acme/vitest-config`](../tooling/vitest/) | Vitest config |
| [`@acme/test-utils`](../tooling/test-utils/) | Shared test helpers |
| [`tooling/github`](../tooling/github/) | Shared GitHub Actions workflows |

---

## DX — developer experience

What the monorepo gives you out of the box, beyond the packages themselves.

- **Turborepo** — task graph, remote-cacheable builds, and **layer-boundary enforcement** (`pnpm boundaries`) — a dependency that points the wrong way fails the build, not a review comment.
- **Eject any app into a standalone repo** — `pnpm prune <app>` ([scripts/extract-app.sh](../scripts/extract-app.sh)) runs `turbo prune` + a config overlay to emit a self-contained single-app repo under `out/` that installs and builds on its own (`pnpm install`), no monorepo required. The slice contract makes an app extractable; this is the proof.
- **Graph-derived dev infra** — `pnpm dev [app]` starts only the Docker services its targets need: the **union of `acme.infra` over each app's transitive package closure** ([scripts/resolve-infra.mjs](../scripts/resolve-infra.mjs)), waits for health, pushes schema, then runs the servers. No `core` always-on set — a slim app derives no Stripe/Redis container because the graph says so ([ADR 0009](adr/0009-graph-derived-dev-infra.md)).
- **A test gate you can trust** — every package declares a `testClass` capability in `package.json`; `pnpm test:policy` (in `quality-gate`) asserts each ships the tests it owes, and tracked gaps are explicit `testStatus: "todo"` (list them with `pnpm test:policy --todos`). A green `pnpm test` means "coverage intent satisfied" ([ADR 0007](adr/0007-package-test-policy.md)).
- **One identity partitions every datastore** — a single `NEXT_PUBLIC_WEBAPP` value namespaces each app's Postgres schema *and* Redis keyspace (via an invisible client `Proxy`), so all four apps share one Postgres + one Redis without collisions, fail-loud if unset ([ADR 0008](adr/0008-per-app-redis-namespace.md)).
- **pnpm workspaces + catalog** — single-version dependency catalog so packages stay aligned.
- **Scaffolding** — `pnpm turbo gen` wires a new package/feature with configs, boundary tags, tRPC plumbing, and a compliant `acme` test-policy block already in place. Never hand-roll a package.
- **Workspace hygiene** — [sherif](https://github.com/QuiiBz/sherif) (`pnpm lint:ws`) for workspace consistency, [knip](https://knip.dev/) (`pnpm deps:check`) for dead code/deps, [syncpack](https://github.com/JamieMason/syncpack) (`pnpm deps:lint`) for version alignment.
- **Git hooks** — [lefthook](https://github.com/evilmartians/lefthook) (installed via `pnpm prepare`), plus [gitleaks](https://github.com/gitleaks/gitleaks) secret scanning.
- **One composite gate** — `pnpm quality-gate` runs lint → format → typecheck → build → boundaries → test-policy → workspace lint → dep lint → gitleaks → test → audit. The same checks CI runs.
- **Testing** — [Vitest](https://vitest.dev) across the monorepo (`pnpm test`, `turbo run test -F <pkg>` for one package).
- **Local infra** — `pnpm infra:up` (Docker Compose): Postgres + pgvector, Redis, LocalStack (S3), `localstripe`, Jaeger (OTel), and Ollama. No cloud accounts needed for full-stack local dev.
- **Database** — [Drizzle](https://orm.drizzle.team) over Postgres + pgvector; `pnpm db:push` / `pnpm db:generate`.
- **Observability** — OpenTelemetry spans on every tRPC procedure, viewable in Jaeger.
- **Mastra** — `pnpm studio` opens the Mastra dev studio against the chat agent; `pnpm lint:mastra` validates the Mastra wiring.
- **AI-native** — `CONTEXT.md` per package, `docs/adr/` for decisions, and an [agent workflow](agents/) (planning + parallel isolated build agents). See below.

### The intended development flow

> First run? [**Getting started**](getting-started.md) is the full step-by-step. The below is the condensed reference.

**First-time setup.**

```bash
nvm use                      # Node 22.19.0 (see .nvmrc)
npm install -g pnpm@latest-10
pnpm i                       # also runs `postinstall` (builds packages, registers agent skills) + `prepare` (lefthook hooks)
```

```bash
cp .env.example .env         # local-dev defaults are non-secret and work as-is
```

Ollama is the default model provider, so **no cloud API keys are required** to run locally. The *full* apps additionally need [Clerk](getting-started.md#auth-clerk-keys-required-for-the-full-apps) keys; the *slim* apps need no auth/billing credentials at all.

**The daily loop.** `pnpm dev` is graph-aware — it brings up the Docker infra each target app's dependency closure needs, waits for health, pushes the schema, then runs the dev servers ([ADR 0009](adr/0009-graph-derived-dev-infra.md)):

```bash
pnpm dev                     # every app — starts the union of infra they need, then all servers
pnpm dev nextjs              # just nextjs (:3000) + only the infra it needs
pnpm dev tanstack-start      # just tanstack-start (:3001)
pnpm dev nextjs-slim         # slim Next.js (:3002) — no Stripe/Redis container derived
pnpm dev tanstack-slim       # slim TanStack Start (:3003)
```

After pulling others' changes, re-run whatever changed: `pnpm i` (deps), `pnpm db:push` (schema). `pnpm dev` re-derives and re-syncs infra on each run (`infra:up` is idempotent).

> Need infra without the servers, or to seed billing? `pnpm infra:up`, `pnpm db:push`, and `pnpm seed:localstripe` are **manual-only** — agents don't run them; `pnpm dev` covers them for interactive use.

**Before you push** — run the same gate CI runs:

```bash
pnpm quality-gate            # lint:fix → format:fix → typecheck+build → boundaries → lint:ws → deps:lint → gitleaks → test → audit
```

(lefthook also runs lint/format on staged files at commit time.)

**Common tasks.**

| I want to… | Do this |
|------------|---------|
| Add a package or feature | `pnpm turbo gen` — never hand-roll one |
| Eject one app into a standalone repo | `pnpm prune <app>` → self-contained tree in `out/` |
| List tracked test-coverage gaps | `pnpm test:policy --todos` |
| Add a shadcn UI component | `pnpm ui-add` |
| Swap LLM / embedding provider | set `LLM_PROVIDER` / `EMBED_PROVIDER` in `.env` (see [ADR 0003](adr/0003-multi-provider-models.md)) |
| Change the DB schema | edit Drizzle schema, then `pnpm db:push` |
| Inspect / debug the chat agent | `pnpm studio` (Mastra studio); `pnpm lint:mastra` to validate wiring |
| See the task graph | `pnpm graph` |
| Find unused deps / exports | `pnpm deps:check` (knip) |
| Align dependency versions | `pnpm deps:lint` / `pnpm deps:update` (syncpack) |
| View traces | open Jaeger (started by `pnpm infra:up`) |
| Tear down infra | `pnpm infra:down` (keep volumes) · `pnpm infra:clean` (drop volumes) |

### Full command reference

Every script in [package.json](../package.json), grouped. ⚠️ = **manual-only** (agents don't run these).

| Command | What it does |
|---------|--------------|
| `pnpm dev [app ...]` | Graph-aware dev: bring up the infra the target apps need (or all apps), wait healthy, push schema, run servers ([ADR 0009](adr/0009-graph-derived-dev-infra.md)) |
| `pnpm build` | Build everything |
| `pnpm build:nextjs` | Build the Next.js app + its deps |
| `pnpm build:nextjs-slim` | Build the slim Next.js app + its deps |
| `pnpm build:tanstack-slim` | Build the slim TanStack Start app + its deps |
| `pnpm prune <app>` | Eject a single app into a self-contained repo under `out/` (`turbo prune` + config overlay) |
| `pnpm clean` | `git clean -xdf node_modules` (nuke installed deps) |
| `pnpm clean:workspaces` | Run each package's `clean` |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Run Vitest across the monorepo |
| `pnpm test:nextjs` | Tests with the Next.js webapp env |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:policy` | Assert every package declares its `testClass` and ships the tests it owes; `--todos` lists tracked gaps ([ADR 0007](adr/0007-package-test-policy.md)) |
| `pnpm lint` / `pnpm lint:fix` | ESLint (cached); `:fix` autofixes |
| `pnpm format` / `pnpm format:fix` | Prettier (cached); `:fix` writes |
| `pnpm boundaries` | Verify layer-boundary rules (`turbo boundaries`) |
| `pnpm lint:ws` / `pnpm lint:ws:fix` | Workspace consistency (sherif) |
| `pnpm lint:mastra` | Validate the Mastra wiring (`@acme/chat`) |
| `pnpm deps:check` | Unused deps/exports (knip) |
| `pnpm deps:lint` / `pnpm deps:format` / `pnpm deps:update` | Version alignment (syncpack) |
| `pnpm gitleaks` | Secret scan (CI enforces; skips gracefully if not installed) |
| `pnpm quality-gate` | The full pre-push gate: lint → format → typecheck+build → boundaries → test-policy → lint:ws → deps:lint → gitleaks → test → audit |
| `pnpm turbo gen` | Scaffold a new package/feature |
| `pnpm ui-add` | Add a shadcn UI component |
| `pnpm skills:register` | Re-link vendored agent skills (`.agents/skills/` → `.claude/skills/`); runs on `postinstall` |
| `pnpm studio` | Mastra dev studio against the chat agent |
| `pnpm graph` | Render the Turbo task graph |
| `pnpm infra:up` | ⚠️ Start Docker infra (postgres/redis/localstack/localstripe/jaeger/ollama) |
| `pnpm infra:down` / `pnpm infra:clean` / `pnpm infra:logs` | ⚠️ Stop / stop+drop-volumes / tail infra |
| `pnpm db:push` / `pnpm db:generate` | ⚠️ Push schema / generate migrations (Drizzle) |
| `pnpm seed:localstripe` | ⚠️ Seed dev billing products/plans |
| `pnpm with-env <cmd>` | Run a command with `.env` loaded (dotenv) |
| `pnpm env:pull` / `pnpm env:push` | ⚠️ Sync local `.env` files with a pluggable secrets backend. `.env.example` is the contract (empty value = secret). Opt-in via `SECRETS_BACKEND` (no default): `localstack` (dev/demo vault) or `aws` (real cloud). See [ADR 0001](adr/0001-pluggable-secrets-sync.md). |

> `db:check`, `db:migrate`, and `db:studio` exist as script names but are currently empty stubs — `db:push` is the wired path.

> Dev, infra, env, and database commands are **manual-only** — agents don't run them.

---

## What's malleable vs load-bearing

The honest answer to "how easily can I change X?". This is the practical side of the [subsetting motivation](../README.md#the-big-idea): some things are designed to be swapped, others are the contract that makes the swapping safe.

### Easy — designed to change

- **Add or remove a feature from an app.** Edit the app's dependencies and its adapter wiring (mount the router, render the provider, drop the components). A client build with no billing, or with an extra bespoke feature, is *a new app importing a different subset* — not a fork. The **slim apps are the worked proof**: they drop auth + billing entirely and inject a constant principal + `unlimitedEntitlements` ([ADR 0010](adr/0010-slim-no-auth-apps.md)).
- **Extract an app from the monorepo.** `pnpm prune <app>` emits a standalone repo for one app — installs and builds with no monorepo. The slice contract is what makes this mechanical rather than a manual untangle.
- **Swap the LLM or embedding provider.** Set `LLM_PROVIDER` / `EMBED_PROVIDER` (chosen independently). Deleting a provider entirely is: delete its file, drop its `case` in `resolve.ts`, `pnpm remove` its SDK. See [ADR 0003](adr/0003-multi-provider-models.md).
- **App shell / theming.** Each app owns its chrome — compare `tanstack-start`'s dark "console shell" to `nextjs`. Feature components are reused untouched.

### Medium — there's a seam, but it costs something

- **Run a feature on a new React framework.** Features and shared packages are runtime-agnostic, but the **adapter** is per-app and must be written: the route handler that mounts the tRPC router, the client URL resolution, and the auth-context resolver ([ADR 0003 auth seam](adr/0003-framework-agnostic-auth-seam.md)). That's the honest boundary — "framework-agnostic where it counts."
- **Change the embedding model.** It fixes the vector dimension, so `EMBED_DIMENSIONS` changes mean re-pushing the vector schema (`pnpm db:push`). A mismatch fails up front with an actionable error, not a raw pgvector crash.
- **The compositions layer.** In flux (see above) — app-owned shells are the current direction.

### Load-bearing — changing these reshapes the template

- **Layer dependency direction** (`tooling → platform → shared → features → compositions → apps`). Enforced by Turborepo boundary tags; violations fail the build.
- **One feature = one package = router + hooks + UI.** The vertical-slice contract is the whole idea — break it and apps can no longer mount features cleanly.
- **tRPC as the feature transport**, with the shared middleware pipeline (auth / trace / time / rate-limit). Every feature reuses it.
- **Clerk for auth.** Behind a framework seam and *droppable* (the slim apps run with no Clerk at all), but the *provider* is still coupled across the full apps' features (`@acme/auth` re-exports Clerk React hooks/components). Swapping Clerk for another provider in the full apps is the remaining work.
- **Stripe for billing** (`localstripe` in dev), **Postgres + pgvector via Drizzle** + **Redis** for persistence, **Mastra** for RAG/memory.
