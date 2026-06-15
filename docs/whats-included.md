# What you get with Trellis

A tour of everything wired up in this template today — features, shared primitives, the platform substrate, and the DX/tooling — followed by an honest map of [what's malleable vs load-bearing](#whats-malleable-vs-load-bearing).

Each entry links to its package `CONTEXT.md` (the domain-language source of truth). The index of all of them is [CONTEXT-MAP.md](../CONTEXT-MAP.md).

Status key: ✅ wired & runnable · 🟡 evolving · 🚧 planned / not built yet.

---

## Apps — what's actually wired up

| App | Framework | Feature subset it mounts | Status |
|-----|-----------|--------------------------|--------|
| [`nextjs`](../apps/nextjs/CONTEXT.md) | Next.js (:3000) | chat · ingest · billing · admin · **sidebar** | ✅ full reference |
| [`tanstack-start`](../apps/tanstack-start/CONTEXT.md) | TanStack Start — Vite + Nitro (:3001) | chat · ingest · billing · admin (app-owned "console shell", no sidebar) | ✅ live, feature parity |
| `express` | Express + Vite (decoupled BE/FE) | core chat slice only — the minimal-subset proof | 🚧 planned |

`nextjs` and `tanstack-start` mount **the same feature slices** through different framework adapters and different shells — that's the portability proof. They already import *different subsets* (`tanstack-start` drops the `sidebar` composition in favour of an app-owned shell), which is the smaller version of the [subsetting idea](../README.md#the-big-idea). `express` is the planned reduced-subset example (core only, no auth/billing/ingest).

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
- **pnpm workspaces + catalog** — single-version dependency catalog so packages stay aligned.
- **Scaffolding** — `pnpm turbo gen` wires a new package/feature with configs, boundary tags, and tRPC plumbing already in place. Never hand-roll a package.
- **Workspace hygiene** — [sherif](https://github.com/QuiiBz/sherif) (`pnpm lint:ws`) for workspace consistency, [knip](https://knip.dev/) (`pnpm deps:check`) for dead code/deps, [syncpack](https://github.com/JamieMason/syncpack) (`pnpm deps:lint`) for version alignment.
- **Git hooks** — [lefthook](https://github.com/evilmartians/lefthook) (installed via `pnpm prepare`), plus [gitleaks](https://github.com/gitleaks/gitleaks) secret scanning.
- **One composite gate** — `pnpm quality-gate` runs lint → format → typecheck → build → boundaries → workspace lint → dep lint → gitleaks → test → audit. The same checks CI runs.
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

For full-stack work (real ingest, auth, billing, persistence) — these are **manual-only**, run them yourself:

```bash
pnpm infra:up                # Docker: postgres+pgvector, redis, localstack(s3), localstripe, jaeger, ollama
cp .env.example .env         # local-dev defaults are non-secret and work as-is
pnpm db:push                 # push the Drizzle schema (confirm prompts)
pnpm seed:localstripe        # seed dev billing products/plans (only if exercising billing)
```

Ollama is the default model provider, so **no cloud API keys are required** to run locally.

**The daily loop.**

```bash
pnpm dev                     # all apps in watch mode (turbo watch, --continue)
pnpm dev:nextjs              # just the Next.js app (:3000)
pnpm dev:tanstack-start      # just the TanStack Start app (:3001)
```

After pulling others' changes, re-run whatever changed: `pnpm i` (deps), `pnpm db:push` (schema), `pnpm infra:up` (infra services).

**Before you push** — run the same gate CI runs:

```bash
pnpm quality-gate            # lint:fix → format:fix → typecheck+build → boundaries → lint:ws → deps:lint → gitleaks → test → audit
```

(lefthook also runs lint/format on staged files at commit time.)

**Common tasks.**

| I want to… | Do this |
|------------|---------|
| Add a package or feature | `pnpm turbo gen` — never hand-roll one |
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
| `pnpm dev` | All apps in watch mode (`turbo watch dev --continue`) |
| `pnpm dev:nextjs` | Next.js app only, with its deps |
| `pnpm dev:tanstack-start` | TanStack Start app only, with its deps |
| `pnpm build` | Build everything |
| `pnpm build:nextjs` | Build the Next.js app + its deps |
| `pnpm clean` | `git clean -xdf node_modules` (nuke installed deps) |
| `pnpm clean:workspaces` | Run each package's `clean` |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Run Vitest across the monorepo |
| `pnpm test:nextjs` | Tests with the Next.js webapp env |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm lint` / `pnpm lint:fix` | ESLint (cached); `:fix` autofixes |
| `pnpm format` / `pnpm format:fix` | Prettier (cached); `:fix` writes |
| `pnpm boundaries` | Verify layer-boundary rules (`turbo boundaries`) |
| `pnpm lint:ws` / `pnpm lint:ws:fix` | Workspace consistency (sherif) |
| `pnpm lint:mastra` | Validate the Mastra wiring (`@acme/chat`) |
| `pnpm deps:check` | Unused deps/exports (knip) |
| `pnpm deps:lint` / `pnpm deps:format` / `pnpm deps:update` | Version alignment (syncpack) |
| `pnpm gitleaks` | Secret scan (CI enforces; skips gracefully if not installed) |
| `pnpm quality-gate` | The full pre-push gate (all of the above + `pnpm audit`) |
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
| `pnpm env:pull` / `pnpm env:push` | ⚠️ Sync local `.env` files with a pluggable secrets backend. `.env.example` is the contract (empty value = secret); default backend is `dotenv-file` (gitignored local JSON, zero setup). See [ADR 0001](adr/0001-pluggable-secrets-sync.md). |

> `db:check`, `db:migrate`, and `db:studio` exist as script names but are currently empty stubs — `db:push` is the wired path.

> Dev, infra, env, and database commands are **manual-only** — agents don't run them.

---

## What's malleable vs load-bearing

The honest answer to "how easily can I change X?". This is the practical side of the [subsetting motivation](../README.md#the-big-idea): some things are designed to be swapped, others are the contract that makes the swapping safe.

### Easy — designed to change

- **Add or remove a feature from an app.** Edit the app's dependencies and its adapter wiring (mount the router, render the provider, drop the components). A client build with no billing, or with an extra bespoke feature, is *a new app importing a different subset* — not a fork.
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
- **Clerk for auth.** Behind a seam, so swappable *in principle*, but currently coupled across features.
- **Stripe for billing** (`localstripe` in dev), **Postgres + pgvector via Drizzle** + **Redis** for persistence, **Mastra** for RAG/memory.
