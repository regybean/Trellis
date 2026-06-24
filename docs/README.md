# Trellis docs

Contents — every doc in the repo, in reading order.

## Start here

| Doc | What it covers |
|-----|----------------|
| [Project README](../README.md) | The big idea, the layered architecture, the apps, quickstart. |
| [Getting started](getting-started.md) | Step-by-step first run: install → infra → env → db → run → verify. |
| [What you get with Trellis](whats-included.md) | Full inventory: features, shared primitives, platform, tooling, the dev flow, the complete command reference, and [what's malleable vs load-bearing](whats-included.md#whats-malleable-vs-load-bearing). |

## Domain language

| Doc | What it covers |
|-----|----------------|
| [CONTEXT-MAP.md](../CONTEXT-MAP.md) | Index of per-package `CONTEXT.md` files (the ubiquitous language). |
| [CLAUDE.md](../CLAUDE.md) | The agent brief: commands, architecture, layer-boundary rules, engineering direction. |

## Working with agents

| Doc | What it covers |
|-----|----------------|
| [Agent workflow](agents/) | Plan (`/grill-with-docs`) → parallel isolated worktree build (`/worktree-build`) → human-reviewed PR. |
| [Worktree workflow](agents/worktree-workflow.md) | How parallel isolated build agents work and the standing rules. |
| [Issue tracker](agents/issue-tracker.md) | Markdown issues + PRDs under `.scratch/`. |
| [Triage labels](agents/triage-labels.md) | The five canonical triage roles. |
| [Domain docs](agents/domain.md) | How skills consume `CONTEXT.md` + ADRs when exploring. |

## Testing

| Doc | What it covers |
|-----|----------------|
| [Testing guide](TESTING.md) | How to write tests in the monorepo. |

## Architectural decision records

System-wide decisions live in [`adr/`](adr/). Per-package ADRs live under each package's `docs/adr/` (indexed from [CONTEXT-MAP.md](../CONTEXT-MAP.md)).

| ADR | Decision |
|-----|----------|
| [0001](adr/0001-pluggable-secrets-sync.md) | Pluggable secrets sync with `.env.example` as the contract. |
| [0002](adr/0002-mastra-rag-and-memory.md) | Mastra owns RAG + Memory; Drizzle mirrors are query-only read models. |
| [0003 (auth)](adr/0003-framework-agnostic-auth-seam.md) | Auth is injected into the tRPC context; the app owns the Clerk resolver. |
| [0003 (models)](adr/0003-multi-provider-models.md) | Multi-provider models behind a single `@acme/models` package. |
| [0004](adr/0004-localstripe-dev-billing.md) | localstripe for dependency-free local-dev billing. |
| [0005](adr/0005-telemetry-init-seam.md) | Telemetry is initialised per-app at the server boundary; the platform assumes no ambient span. |
| [0006](adr/0006-entitlements-injection-seam.md) | Billing is injected into the tRPC context as an `EntitlementsProvider`. |
| [0007](adr/0007-package-test-policy.md) | Every package declares a `testClass` so the root test gate is trustworthy. |
| [0008](adr/0008-per-app-redis-namespace.md) | Each app gets its own Redis key namespace, prefixed from `NEXT_PUBLIC_WEBAPP`. |
| [0009](adr/0009-graph-derived-dev-infra.md) | `pnpm dev` derives the infra it starts from the dependency graph, not a per-app list. |
| [0010](adr/0010-slim-no-auth-apps.md) | Slim apps are separate no-auth deployments that inject a constant admin principal. |
