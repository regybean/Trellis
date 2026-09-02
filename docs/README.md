# Trellis docs

Contents — every doc in the repo, in reading order.

## Start here

| Doc                                            | What it covers                                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Project README](../README.md)                 | The big idea, the layered architecture, the apps, quickstart.                                                                                                                                            |
| [Getting started](getting-started.md)          | Step-by-step first run: install → infra → env → db → run → verify.                                                                                                                                       |
| [What you get with Trellis](whats-included.md) | Full inventory: features, shared primitives, platform, tooling, the dev flow, the complete command reference, and [what's malleable vs load-bearing](whats-included.md#whats-malleable-vs-load-bearing). |

## Domain language

| Doc                                 | What it covers                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| [CONTEXT-MAP.md](../CONTEXT-MAP.md) | Index of per-package `CONTEXT.md` files (the ubiquitous language).                    |
| [CLAUDE.md](../CLAUDE.md)           | The agent brief: commands, architecture, layer-boundary rules, engineering direction. |

## Working with agents

| Doc                                              | What it covers                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| [Agent workflow](agents/)                        | Plan (`/grill-with-docs`) → parallel isolated worktree build (`/implement`) → human-reviewed PR. |
| [Worktree workflow](agents/worktree-workflow.md) | How parallel isolated build agents work and the standing rules.                                  |
| [Issue tracker](agents/issue-tracker.md)         | Markdown issues + PRDs under `.scratch/`.                                                        |
| [Triage labels](agents/triage-labels.md)         | The five canonical triage roles.                                                                 |
| [Domain docs](agents/domain.md)                  | How skills consume `CONTEXT.md` + ADRs when exploring.                                           |

## Testing

| Doc                         | What it covers                      |
| --------------------------- | ----------------------------------- |
| [Testing guide](TESTING.md) | How to write tests in the monorepo. |

## Architectural decision records

System-wide decisions live in [`adr/`](adr/). Per-package ADRs live under each package's `docs/adr/` (indexed from [CONTEXT-MAP.md](../CONTEXT-MAP.md)).

| ADR                                                                      | Decision                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [0001](adr/0001-pluggable-secrets-sync.md)                               | Pluggable secrets sync with `.env.example` as the contract.                                    |
| [0002](adr/0002-mastra-rag-and-memory.md)                                | Mastra owns RAG + Memory; Drizzle mirrors are query-only read models.                          |
| [0003 (auth)](adr/0003-framework-agnostic-auth-seam.md)                  | Auth is injected into the tRPC context; the app owns the session resolver.                     |
| [0003 (models)](adr/0003-multi-provider-models.md)                       | Multi-provider models behind a single `@acme/models` package.                                  |
| [0004](adr/0004-localstripe-dev-billing.md)                              | localstripe for dependency-free local-dev billing.                                             |
| [0005](adr/0005-telemetry-init-seam.md)                                  | Telemetry is initialised per-app at the server boundary; the platform assumes no ambient span. |
| [0006](adr/0006-entitlements-injection-seam.md)                          | Billing is injected into the tRPC context as an `EntitlementsProvider`.                        |
| [0007](adr/0007-package-test-policy.md)                                  | Every package declares a `testClass` so the root test gate is trustworthy.                     |
| [0008](adr/0008-per-app-redis-namespace.md)                              | Each app gets its own Redis key namespace, prefixed from `NEXT_PUBLIC_WEBAPP`.                 |
| [0009](adr/0009-graph-derived-dev-infra.md)                              | `pnpm dev` derives the infra it starts from the dependency graph, not a per-app list.          |
| [0010](adr/0010-slim-no-auth-apps.md)                                    | Slim apps are separate no-auth deployments that inject a constant admin principal.             |
| [0011](adr/0011-remove-compositions-layer.md)                            | Compositions layer removed; shell/chrome is always app-owned.                                  |
| [0012](adr/0012-folder-storage-split.md)                                 | Conversation Folders: split storage, lazy delete.                                              |
| [0013](adr/0013-admin-user-widgets-to-ui.md)                             | Framework-agnostic admin user widgets belong in `@acme/ui`, not duplicated per app.            |
| [0014](adr/0014-tests-validate-real-env.md)                              | Tests validate real env instead of mocking `env.ts`.                                           |
| [0015](adr/0015-package-exports-convention.md)                           | Package `exports` follow a bounded, concern-driven convention.                                 |
| [0016](adr/0016-db-connection-platform-package.md)                       | The Postgres connection lives in `@acme/db`, peer to `@acme/redis`.                            |
| [0017](adr/0017-test-infra-owned-by-infra-package.md)                    | A suite declares its test infra explicitly; the infra package owns the descriptor.             |
| [0018](adr/0018-frontend-test-doctrine.md)                               | Frontend tests fake the network at the HTTP boundary and assert what renders.                  |
| [0019](adr/0019-worktrees-mirror-ci-test-infra.md)                       | Test-infra mode follows `CI`; worktrees mirror CI. **Superseded by 0034 (tests).**             |
| [0020](adr/0020-commit-tidies-gate-verifies.md)                          | Commit tidies, the gate verifies: tiered quality checks.                                       |
| [0021](adr/0021-test-schema-provisioning-db-push.md)                     | Testcontainer schemas are provisioned by the app's `drizzle-kit push --force`.                 |
| [0022](adr/0022-centralized-env-validation-policy.md)                    | The env-validation skip is one policy in `@acme/env`, not a predicate copied per package.      |
| [0023](adr/0023-ambient-telemetry-no-context-object.md)                  | Telemetry is ambient (read from the active OTel span), never threaded through tRPC context.    |
| [0024](adr/0024-ci-build-stubs-for-infra-client-env.md)                  | CI build stubs for infrastructure-client env vars.                                             |
| [0025](adr/0025-per-query-indexeddb-persister.md)                        | A per-query IndexedDB persister gives chat + feedback an offline read.                         |
| [0026](adr/0026-config-as-code.md)                                       | Non-sensitive config is code, not env; `@acme/config` mirrors `@acme/env`.                     |
| [0027](adr/0027-dependency-audit-gate-and-suppression-policy.md)         | Dependency-audit gate and suppression policy.                                                  |
| [0028](adr/0028-dev-and-compose-logs-mirrored-to-files-for-the-agent.md) | Dev-server + compose output is mirrored to `logs/*.log` for agents to read.                    |
| [0029](adr/0029-per-app-env-ownership.md)                                | Each app owns its full env surface; the shared root `.env` is deprecated.                      |
| [0030](adr/0030-notifications-seam.md)                                   | `@acme/notifications` is a shared package that owns a tRPC router.                             |
| [0031](adr/0031-ingest-progress-survives-refresh.md)                     | Ingest progress survives a refresh: snapshot, then resume from `lastId`.                       |
| [0032](adr/0032-durable-redis-stream-primitive.md)                       | One durable Redis-stream primitive behind chat / ingest / notifications.                       |
| [0033 (env)](adr/0033-one-env-factory-per-slice.md)                      | One env factory per slice; profiles ride `createFinalSchema` and every key is overridable.     |
| [0033 (forms)](adr/0033-tanstack-form-in-acme-ui.md)                     | TanStack Form is the form library, and `@acme/ui` is where it lands.                           |
| [0034 (auth)](adr/0034-self-hosted-better-auth.md)                       | Auth is self-hosted Better Auth, with sessions as rows in Postgres.                            |
| [0034 (tests)](adr/0034-backend-tests-always-self-provision.md)          | Backend tests always self-provision testcontainers; `CI` leaves the test cache hash.           |
| [0035](adr/0035-auth-tables-in-a-dedicated-schema.md)                    | Auth tables live in a dedicated `auth` schema, outside the per-app one.                        |
| [0036](adr/0036-one-app-owned-query-client.md)                           | One app-owned QueryClient; cache policy is declared per query, not per feature.                |
