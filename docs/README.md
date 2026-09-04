# Trellis docs

Contents — every doc in the repo, in reading order.

## Start here

| Doc                                            | What it covers                                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Project README](../README.md)                 | The big idea, the layered architecture, the apps, quickstart.                                                                                                                                            |
| [Getting started](getting-started.md)          | Step-by-step first run: install → infra → env → db → run → verify.                                                                                                                                       |
| [What you get with Trellis](whats-included.md) | Full inventory: features, shared primitives, platform, tooling, the dev flow, the complete command reference, and [what's malleable vs load-bearing](whats-included.md#whats-malleable-vs-load-bearing). |
| [The bank](bank.md)                            | Consuming Trellis packages in another repo: pinning a tag, syncing, resolving conflicts, reading a drift report.                                                                                         |

## Mounting a package into an app

| Doc                           | What it covers                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Mounting recipes](mounting/) | The wiring that is the same whichever package you mount: route, provider, schema, env, worker, UI, infra. |
| `packages/*/*/ADAPTER.md`     | Per package: what it gives an app, its client/server surface, and what you wire.                          |

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
| [Domain docs](agents/domain.md)                  | Where an ADR lives, what a status may say, and what a `CONTEXT.md` holds.                        |

## Testing

| Doc                         | What it covers                      |
| --------------------------- | ----------------------------------- |
| [Testing guide](TESTING.md) | How to write tests in the monorepo. |

## Architectural decision records

An ADR lives with what it governs: repo-wide decisions here in [`adr/`](adr/), a
package's own in its `docs/adr/`. The placement test, the per-directory
numbering, and the status vocabulary are stated once in
[agents/domain.md](agents/domain.md#where-an-adr-lives).

### System-wide

| ADR                                                                      | Decision                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [0001](adr/0001-pluggable-secrets-sync.md)                               | Pluggable secrets sync with `.env.example` as the contract.                                 |
| [0003](adr/0003-framework-agnostic-auth-seam.md)                         | Auth is injected into the tRPC context; the app owns the session resolver.                  |
| [0006](adr/0006-entitlements-injection-seam.md)                          | Billing is injected into the tRPC context as an `EntitlementsProvider`.                     |
| [0007](adr/0007-package-test-policy.md)                                  | Every package declares a `testClass` so the root test gate is trustworthy.                  |
| [0008](adr/0008-per-app-redis-namespace.md)                              | Each app gets its own Redis key namespace, prefixed from `NEXT_PUBLIC_WEBAPP`.              |
| [0009](adr/0009-graph-derived-dev-infra.md)                              | `pnpm dev` derives the infra it starts from the dependency graph, not a per-app list.       |
| [0010](adr/0010-slim-no-auth-apps.md)                                    | Slim apps are separate no-auth deployments that inject a constant admin principal.          |
| [0011](adr/0011-remove-compositions-layer.md)                            | Compositions layer removed; shell/chrome is always app-owned.                               |
| [0014](adr/0014-tests-validate-real-env.md)                              | Tests validate real env instead of mocking `env.ts`.                                        |
| [0015](adr/0015-package-exports-convention.md)                           | Package `exports` follow a bounded, concern-driven convention.                              |
| [0017](adr/0017-test-infra-owned-by-infra-package.md)                    | A suite declares its test infra explicitly; the infra package owns the descriptor.          |
| [0018](adr/0018-frontend-test-doctrine.md)                               | Frontend tests fake the network at the HTTP boundary and assert what renders.               |
| [0020](adr/0020-commit-tidies-gate-verifies.md)                          | Commit tidies, the gate verifies: tiered quality checks.                                    |
| [0021](adr/0021-test-schema-provisioning-db-push.md)                     | Testcontainer schemas are provisioned by the app's `drizzle-kit push --force`.              |
| [0023](adr/0023-ambient-telemetry-no-context-object.md)                  | Telemetry is ambient (read from the active OTel span), never threaded through tRPC context. |
| [0024](adr/0024-ci-build-stubs-for-infra-client-env.md)                  | CI build stubs for infrastructure-client env vars.                                          |
| [0027](adr/0027-dependency-audit-gate-and-suppression-policy.md)         | Dependency-audit gate and suppression policy.                                               |
| [0028](adr/0028-dev-and-compose-logs-mirrored-to-files-for-the-agent.md) | Dev-server + compose output is mirrored to `logs/*.log` for agents to read.                 |
| [0029](adr/0029-per-app-env-ownership.md)                                | Each app owns its full env surface; the shared root `.env` is deprecated.                   |
| [0034](adr/0034-backend-tests-always-self-provision.md)                  | Backend tests always self-provision testcontainers; `CI` leaves the test cache hash.        |
| [0036](adr/0036-one-app-owned-query-client.md)                           | One app-owned QueryClient; cache policy is declared per query, not per feature.             |
| [0037](adr/0037-vendored-git-subset-three-way-merge.md)                  | Consumers take a vendored git subset and update it by three-way merge.                      |
| [0038](adr/0038-acme-scope-is-a-distribution-constraint.md)              | The `@acme` scope is a distribution constraint, not placeholder naming.                     |
| [0039](adr/0039-the-selection-is-the-contract.md)                        | The selection is the contract: neither side of the bank enumerates paths.                   |

### Per package

Each package's own sequence, starting at `0001` — independent of the root's, so
`@acme/auth` 0001 and root 0001 are different decisions and that is normal.
`CONTEXT-MAP.md` lists these alongside the root ADRs that also govern each
package.

| Package               | ADR                                                                                              | Decision                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `@acme/auth`          | [0001](../packages/shared/auth/docs/adr/0001-self-hosted-better-auth.md)                         | Auth is self-hosted Better Auth, with sessions as rows in Postgres.                        |
| `@acme/auth`          | [0002](../packages/shared/auth/docs/adr/0002-auth-tables-in-a-dedicated-schema.md)               | Auth tables live in a dedicated `auth` schema, outside the per-app one.                    |
| `@acme/billing`       | [0001](../packages/features/billing/docs/adr/0001-localstripe-dev-billing.md)                    | localstripe for dependency-free local-dev billing.                                         |
| `@acme/chat`          | [0002](../packages/features/chat/docs/adr/0002-mastra-memory-owns-conversation-persistence.md)   | Mastra Memory owns Conversation persistence; the procedure orchestrates a thread.          |
| `@acme/chat`          | [0003](../packages/features/chat/docs/adr/0003-conversation-ownership-as-middleware.md)          | Conversation ownership is a middleware seam, not a per-procedure check.                    |
| `@acme/chat`          | [0004](../packages/features/chat/docs/adr/0004-generation-worker-and-queue.md)                   | Generation runs in a worker behind a queue, decoupled from the client connection.          |
| `@acme/chat`          | [0005](../packages/features/chat/docs/adr/0005-folder-storage-split.md)                          | Conversation Folders: split storage, lazy delete.                                          |
| `@acme/chat`          | [0006](../packages/features/chat/docs/adr/0006-credits-metered-in-the-turn-control-plane.md)     | Credits are metered in the Turn control plane, and the refund guard is chat's.             |
| `@acme/chat`          | [0007](../packages/features/chat/docs/adr/0007-message-actions-render-slot.md)                   | Per-message actions are an app-wired render slot, not a feature dependency.                |
| `@acme/chat`          | [0008](../packages/features/chat/docs/adr/0008-deep-link-url-via-history-api.md)                 | The Conversation deep link is reconciled with the History API, never the router.           |
| `@acme/db`            | [0001](../packages/platform/db/docs/adr/0001-db-connection-platform-package.md)                  | The Postgres connection lives in `@acme/db`, peer to `@acme/redis`.                        |
| `@acme/env`           | [0001](../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md)                      | One env factory per slice; profiles ride `createFinalSchema` and every key is overridable. |
| `@acme/env`           | [0002](../packages/platform/env/docs/adr/0002-secret-requiredness-is-derived-never-declared.md)  | A secret's requiredness is derived, never declared — three axes, no `.optional()`.         |
| `@acme/feedback`      | [0001](../packages/features/feedback/docs/adr/0001-feedback-references-mastra-ids-without-fk.md) | Feedback references Mastra ids by value, with no foreign key.                              |
| `@acme/hooks`         | [0001](../packages/shared/hooks/docs/adr/0001-per-query-indexeddb-persister.md)                  | A per-query IndexedDB persister gives chat + feedback an offline read.                     |
| `@acme/ingest`        | [0001](../packages/features/ingest/docs/adr/0001-ingest-progress-survives-refresh.md)            | Ingest progress survives a refresh: snapshot, then resume from `lastId`.                   |
| `@acme/ingest`        | [0002](../packages/features/ingest/docs/adr/0002-browser-direct-s3-upload.md)                    | Bytes go browser→S3 direct, and a batch fails per file.                                    |
| `@acme/ingest`        | [0003](../packages/features/ingest/docs/adr/0003-one-per-user-progress-stream.md)                | One progress stream per user, carrying no job-level terminal.                              |
| `@acme/ingest`        | [0004](../packages/features/ingest/docs/adr/0004-two-authors-one-pure-reducer.md)                | Two authors, one pure reducer, forward-only stage ranks.                                   |
| `@acme/ingest`        | [0005](../packages/features/ingest/docs/adr/0005-documents-list-is-the-only-persisted-query.md)  | `documents.list` is the only persisted query.                                              |
| `@acme/models`        | [0001](../packages/shared/models/docs/adr/0001-multi-provider-models.md)                         | Multi-provider models behind a single `@acme/models` package.                              |
| `@acme/models`        | [0002](../packages/shared/models/docs/adr/0002-one-authored-value-per-role.md)                   | One authored value per role, validated as a discriminated union.                           |
| `@acme/notifications` | [0001](../packages/shared/notifications/docs/adr/0001-notifications-seam.md)                     | `@acme/notifications` is a shared package that owns a tRPC router.                         |
| `@acme/rag`           | [0001](../packages/shared/rag/docs/adr/0001-mastra-rag-and-memory.md)                            | Mastra owns RAG + Memory; Drizzle mirrors are query-only read models.                      |
| `@acme/rag`           | [0002](../packages/shared/rag/docs/adr/0002-knowledge-base-index-provisioned-at-boot.md)         | The knowledge-base index is provisioned at boot, at a configured dimension.                |
| `@acme/rag`           | [0003](../packages/shared/rag/docs/adr/0003-single-file-upload-with-injected-stage-reporting.md) | Indexing is one file at a time, with stage reporting injected.                             |
| `@acme/rag`           | [0004](../packages/shared/rag/docs/adr/0004-thread-ownership-rule-and-its-one-trpc-adapter.md)   | The thread-ownership rule is transport-free, with exactly one tRPC adapter.                |
| `@acme/redis`         | [0001](../packages/platform/redis/docs/adr/0001-durable-redis-stream-primitive.md)               | One durable Redis-stream primitive behind chat / ingest / notifications.                   |
| `@acme/trpc`          | [0001](../packages/platform/trpc/docs/adr/0001-no-name-keyed-client-registry.md)                 | Feature tRPC client wiring is two factories, not a name-keyed registry.                    |
| `@acme/trpc`          | [0002](../packages/platform/trpc/docs/adr/0002-export-the-pieces-not-the-instance.md)            | Export the pieces; the feature builds the tRPC instance.                                   |
| `@acme/trpc`          | [0003](../packages/platform/trpc/docs/adr/0003-handler-plumbing-here-resolver-in-the-app.md)     | Handler plumbing lives here; the context resolver stays in the app.                        |
| `@acme/trpc`          | [0004](../packages/platform/trpc/docs/adr/0004-test-caller-context-in-the-testing-subpath.md)    | The test caller context lives in `@acme/trpc/testing`, and takes the session whole.        |
| `@acme/ui`            | [0001](../packages/shared/ui/docs/adr/0001-admin-user-widgets-to-ui.md)                          | Framework-agnostic admin user widgets belong in `@acme/ui`, not duplicated per app.        |
| `@acme/ui`            | [0002](../packages/shared/ui/docs/adr/0002-tanstack-form-in-acme-ui.md)                          | TanStack Form is the form library, and `@acme/ui` is where it lands.                       |
