# Getting started

A step-by-step first run. For the full command list and the day-to-day flow, see [what you get → DX](whats-included.md#dx--developer-experience).

## Prerequisites

- **Node 22.19.0** — `nvm use` reads [.nvmrc](../.nvmrc).
- **pnpm ≥ 10.15.1** — `npm install -g pnpm@latest-10`.
- **Docker** — for local infra (Postgres, Redis, S3, billing, tracing, Ollama). No cloud accounts needed.

## 1. Install

```bash
nvm use
pnpm i
```

`pnpm i` also runs `postinstall` (builds the workspace packages and registers the vendored agent skills via `pnpm skills:register`) and `prepare` (installs the lefthook git hooks).

## 2. Configure env

The committed [`.env.example`](../.env.example) holds non-secret local-dev defaults that work as-is:

```bash
cp .env.example .env
```

For secrets (anything declared with an empty value in `.env.example`), use the pluggable sync instead of editing by hand:

```bash
pnpm env:pull            # fetches secrets from the configured backend into your .env
```

Default backend is `dotenv-file` (a gitignored local JSON — zero setup). The backend is selectable in [`secrets.config.sh`](../secrets.config.sh); see [ADR 0001](adr/0001-pluggable-secrets-sync.md).

### Auth: Clerk keys (required for both apps)

Both `nextjs` and `tanstack-start` require [Clerk](https://clerk.com) today — it's the one credential you can't stub locally (the framework is behind a seam, the provider isn't yet; see [README → known rough edges](../README.md#known-rough-edges)). Create a free Clerk app, then set its two keys from the [API keys](https://dashboard.clerk.com/last-active?path=api-keys) page:

| Var | Where | Value |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | both apps | `pk_test_…` (Publishable key) |
| `CLERK_SECRET_KEY` | both apps | `sk_test_…` (Secret key) |
| `CLERK_PUBLISHABLE_KEY` | `tanstack-start` only | same `pk_test_…` — its server SDK doesn't read `NEXT_PUBLIC_*` |

Set them per app in `apps/nextjs/.env` and `apps/tanstack-start/.env`. The `*_SIGN_IN_URL` / `*_SIGN_UP_URL` vars already have working defaults.

**Roles** — admin-only actions (e.g. uploading docs on the ingest/admin page) are gated on a `role` claim (`admin` | `user`, typed in [globals.d.ts](../packages/shared/auth/src/types/globals.d.ts)). To make yourself an admin, set this in the user's **public metadata** in the Clerk dashboard:

```json
{ "role": "admin" }
```

### Choosing a model provider

Configure this **before** starting infra — `infra:up` only spins up Ollama when a provider below is set to `ollama`.

LLM and embeddings providers are selected independently via `LLM_PROVIDER` / `EMBED_PROVIDER` in `.env`:

| Provider | `LLM_PROVIDER` | `EMBED_PROVIDER` | Notes |
|---|---|---|---|
| **Ollama** (default) | `ollama` | `ollama` | Local, CPU-only, no API keys. Started by `infra:up`. |
| AWS Bedrock | `bedrock` | `bedrock` | Requires AWS credentials in `.env`. |
| OpenRouter | `openrouter` | — | No embeddings API; pair with `EMBED_PROVIDER=ollama` or `bedrock`. |

The defaults (`LLM_PROVIDER=ollama`, `EMBED_PROVIDER=ollama`) work out of the box with no secrets. To switch, change the provider vars and set the corresponding credentials.

## 3. Start local infra

Manual-only — run it yourself:

```bash
pnpm infra:up
```

Brings up, via Docker Compose: **Postgres + pgvector**, **Redis**, **LocalStack** (S3), **localstripe** (dev billing), **Jaeger** (OTel traces), and — when `LLM_PROVIDER` or `EMBED_PROVIDER` is `ollama` — **Ollama** (local, CPU-only, so no API keys).

## 4. Push the database schema

```bash
pnpm db:push             # Drizzle → Postgres + pgvector (confirm prompts)
```

If you exercise billing, also seed the dev products/plans:

```bash
pnpm seed:localstripe
```

## 5. Run

```bash
pnpm dev                 # all apps in watch mode
```

- **nextjs** → http://localhost:3000 (full reference: chat · ingest · billing · admin · sidebar)
- **tanstack-start** → http://localhost:3001 (same slices, app-owned "console shell")

Run a single app with `pnpm dev:nextjs` or `pnpm dev:tanstack-start`.

## 6. Verify it works

- Open the chat and send a message — it streams a response (RAG over the knowledge base, via Ollama by default).
- Upload a document on the admin / ingest page, then ask about it.
- View the request traces in **Jaeger** (started by `pnpm infra:up`).

## Keeping up to date

After pulling others' changes, re-run whatever changed:

```bash
pnpm i                   # dependencies changed
pnpm db:push             # schema changed
pnpm infra:up            # infra services changed
```

## Before you push

Run the same gate CI runs (lefthook also lints/formats staged files at commit time):

```bash
pnpm quality-gate
```

## Where to next

- [What you get with Trellis](whats-included.md) — full feature, tooling, and command inventory.
- [The big idea](../README.md#the-big-idea) — why features are slices and how apps mount subsets.
- [Agent workflow](agents/) — how to plan and build changes with coding agents.
- [CONTEXT-MAP.md](../CONTEXT-MAP.md) — the domain-language index across packages.
