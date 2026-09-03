# Context Map

This monorepo uses per-package `CONTEXT.md` files for domain language and `docs/adr/` for architectural decisions. Each runtime package also carries an `ADAPTER.md` — what it gives an app, its client/server surface, and what an app has to wire. The shared wiring those documents link to is [`docs/mounting/`](docs/mounting/).

## System-wide

Repo-wide decisions live in [`docs/adr/`](docs/adr/). A package's own decisions
live in its `docs/adr/` and are listed per row below. Placement is the deletion
test — if deleting the package takes the decision with it, the ADR belongs to the
package. Numbering is **per directory**: the same number in root and in a package
is normal.

| ADR                                                                             | Decision                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`0001`](docs/adr/0001-pluggable-secrets-sync.md)                               | Pluggable secrets sync with `.env.example` as the contract.                                                              |
| [`0003`](docs/adr/0003-framework-agnostic-auth-seam.md)                         | Auth is injected into the tRPC context; the app owns the session resolver.                                               |
| [`0006`](docs/adr/0006-entitlements-injection-seam.md)                          | Billing is injected into the tRPC context as an `EntitlementsProvider`.                                                  |
| [`0007`](docs/adr/0007-package-test-policy.md)                                  | Every package declares a `testClass` so the root test gate is trustworthy.                                               |
| [`0008`](docs/adr/0008-per-app-redis-namespace.md)                              | Each app gets its own Redis key namespace, prefixed from `NEXT_PUBLIC_WEBAPP`.                                           |
| [`0009`](docs/adr/0009-graph-derived-dev-infra.md)                              | `pnpm dev` derives the infra it starts from the dependency graph.                                                        |
| [`0010`](docs/adr/0010-slim-no-auth-apps.md)                                    | Slim apps are separate no-auth deployments that inject a constant admin principal.                                       |
| [`0011`](docs/adr/0011-remove-compositions-layer.md)                            | Compositions layer removed; shell/chrome is always app-owned.                                                            |
| [`0014`](docs/adr/0014-tests-validate-real-env.md)                              | Tests validate real env instead of mocking `env.ts`.                                                                     |
| [`0015`](docs/adr/0015-package-exports-convention.md)                           | Package `exports` follow a bounded, concern-driven convention (enforced by `scripts/check-exports.mjs` via `pnpm lint`). |
| [`0017`](docs/adr/0017-test-infra-owned-by-infra-package.md)                    | A suite declares its test infra explicitly; the infra package owns the descriptor.                                       |
| [`0018`](docs/adr/0018-frontend-test-doctrine.md)                               | Frontend tests fake the network at the HTTP boundary and assert what renders.                                            |
| [`0020`](docs/adr/0020-commit-tidies-gate-verifies.md)                          | Commit tidies, the gate verifies: tiered quality checks.                                                                 |
| [`0021`](docs/adr/0021-test-schema-provisioning-db-push.md)                     | Testcontainer schemas are provisioned by the app's `drizzle-kit push --force`.                                           |
| [`0023`](docs/adr/0023-ambient-telemetry-no-context-object.md)                  | Telemetry is ambient, never threaded through tRPC context.                                                               |
| [`0024`](docs/adr/0024-ci-build-stubs-for-infra-client-env.md)                  | CI build stubs for infrastructure-client env vars.                                                                       |
| [`0027`](docs/adr/0027-dependency-audit-gate-and-suppression-policy.md)         | Dependency-audit gate and suppression policy.                                                                            |
| [`0028`](docs/adr/0028-dev-and-compose-logs-mirrored-to-files-for-the-agent.md) | Dev-server + compose output is mirrored to `logs/*.log` for agents to read.                                              |
| [`0029`](docs/adr/0029-per-app-env-ownership.md)                                | Each app owns its full env surface; the shared root `.env` is deprecated.                                                |
| [`0034`](docs/adr/0034-backend-tests-always-self-provision.md)                  | Backend tests always self-provision testcontainers.                                                                      |
| [`0036`](docs/adr/0036-one-app-owned-query-client.md)                           | One app-owned QueryClient; cache policy is declared per query.                                                           |
| [`0037`](docs/adr/0037-vendored-git-subset-three-way-merge.md)                  | Consumers take a vendored git subset and update it by three-way merge.                                                   |
| [`0038`](docs/adr/0038-acme-scope-is-a-distribution-constraint.md)              | The `@acme` scope is a distribution constraint, not placeholder naming.                                                  |
| [`0039`](docs/adr/0039-the-selection-is-the-contract.md)                        | The selection is the contract: neither side of the bank enumerates paths.                                                |

## Packages

| Package                            | Context                                                    | Adapter                                                    | ADRs                                                   | Also governed by       |
| ---------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ | ---------------------- |
| `packages/platform/trpc/`          | [`CONTEXT.md`](packages/platform/trpc/CONTEXT.md)          | [`ADAPTER.md`](packages/platform/trpc/ADAPTER.md)          | [`docs/adr/`](packages/platform/trpc/docs/adr/)        | `0003`, `0006`, `0010` |
| `packages/platform/entitlements/`  | [`CONTEXT.md`](packages/platform/entitlements/CONTEXT.md)  | [`ADAPTER.md`](packages/platform/entitlements/ADAPTER.md)  | —                                                      | `0006`                 |
| `packages/platform/subscriptions/` | [`CONTEXT.md`](packages/platform/subscriptions/CONTEXT.md) | [`ADAPTER.md`](packages/platform/subscriptions/ADAPTER.md) | —                                                      | `0006`                 |
| `packages/platform/queue/`         | [`CONTEXT.md`](packages/platform/queue/CONTEXT.md)         | [`ADAPTER.md`](packages/platform/queue/ADAPTER.md)         | —                                                      | —                      |
| `packages/platform/redis/`         | [`CONTEXT.md`](packages/platform/redis/CONTEXT.md)         | —                                                          | [`docs/adr/`](packages/platform/redis/docs/adr/)       | `0008`                 |
| `packages/platform/db/`            | [`CONTEXT.md`](packages/platform/db/CONTEXT.md)            | [`ADAPTER.md`](packages/platform/db/ADAPTER.md)            | [`docs/adr/`](packages/platform/db/docs/adr/)          | `0017`, `0021`         |
| `packages/platform/env/`           | [`CONTEXT.md`](packages/platform/env/CONTEXT.md)           | [`ADAPTER.md`](packages/platform/env/ADAPTER.md)           | [`docs/adr/`](packages/platform/env/docs/adr/)         | `0014`, `0024`, `0029` |
| `packages/shared/auth/`            | [`CONTEXT.md`](packages/shared/auth/CONTEXT.md)            | [`ADAPTER.md`](packages/shared/auth/ADAPTER.md)            | [`docs/adr/`](packages/shared/auth/docs/adr/)          | `0003`, `0010`         |
| `packages/shared/hooks/`           | [`CONTEXT.md`](packages/shared/hooks/CONTEXT.md)           | [`ADAPTER.md`](packages/shared/hooks/ADAPTER.md)           | [`docs/adr/`](packages/shared/hooks/docs/adr/)         | `0003`, `0036`         |
| `packages/shared/models/`          | [`CONTEXT.md`](packages/shared/models/CONTEXT.md)          | [`ADAPTER.md`](packages/shared/models/ADAPTER.md)          | [`docs/adr/`](packages/shared/models/docs/adr/)        | —                      |
| `packages/shared/rag/`             | [`CONTEXT.md`](packages/shared/rag/CONTEXT.md)             | [`ADAPTER.md`](packages/shared/rag/ADAPTER.md)             | [`docs/adr/`](packages/shared/rag/docs/adr/)           | —                      |
| `packages/shared/notifications/`   | [`CONTEXT.md`](packages/shared/notifications/CONTEXT.md)   | [`ADAPTER.md`](packages/shared/notifications/ADAPTER.md)   | [`docs/adr/`](packages/shared/notifications/docs/adr/) | —                      |
| `packages/shared/ui/`              | —                                                          | [`ADAPTER.md`](packages/shared/ui/ADAPTER.md)              | [`docs/adr/`](packages/shared/ui/docs/adr/)            | `0011`, `0018`         |
| `packages/features/billing/`       | [`CONTEXT.md`](packages/features/billing/CONTEXT.md)       | [`ADAPTER.md`](packages/features/billing/ADAPTER.md)       | [`docs/adr/`](packages/features/billing/docs/adr/)     | `0006`                 |
| `packages/features/chat/`          | [`CONTEXT.md`](packages/features/chat/CONTEXT.md)          | [`ADAPTER.md`](packages/features/chat/ADAPTER.md)          | [`docs/adr/`](packages/features/chat/docs/adr/)        | `0006`                 |
| `packages/features/feedback/`      | [`CONTEXT.md`](packages/features/feedback/CONTEXT.md)      | [`ADAPTER.md`](packages/features/feedback/ADAPTER.md)      | [`docs/adr/`](packages/features/feedback/docs/adr/)    | —                      |
| `packages/features/ingest/`        | [`CONTEXT.md`](packages/features/ingest/CONTEXT.md)        | [`ADAPTER.md`](packages/features/ingest/ADAPTER.md)        | [`docs/adr/`](packages/features/ingest/docs/adr/)      | —                      |
| `packages/platform/logger/`        | —                                                          | [`ADAPTER.md`](packages/platform/logger/ADAPTER.md)        | —                                                      | —                      |
| `packages/platform/telemetry/`     | —                                                          | [`ADAPTER.md`](packages/platform/telemetry/ADAPTER.md)     | —                                                      | `0023`                 |

## Tooling

`tooling/*` owns no ADR directory: its decisions govern the repo-wide gate rather
than the config package, so they stay at the root.

| Package               | Context                                       | Also governed by               |
| --------------------- | --------------------------------------------- | ------------------------------ |
| `tooling/test-utils/` | [`CONTEXT.md`](tooling/test-utils/CONTEXT.md) | `0014`, `0017`, `0021`, `0034` |

## Apps

| App                    | Context                                        | Also governed by               |
| ---------------------- | ---------------------------------------------- | ------------------------------ |
| `apps/nextjs/`         | [`CONTEXT.md`](apps/nextjs/CONTEXT.md)         | `0003`, `0023`, `0029`         |
| `apps/nextjs-slim/`    | [`CONTEXT.md`](apps/nextjs-slim/CONTEXT.md)    | `0006`, `0010`, `0029`         |
| `apps/tanstack-start/` | [`CONTEXT.md`](apps/tanstack-start/CONTEXT.md) | `0003`, `0023`, `0029`         |
| `apps/tanstack-slim/`  | [`CONTEXT.md`](apps/tanstack-slim/CONTEXT.md)  | `0006`, `0010`, `0023`, `0029` |

> Add rows as you create context files. Run `/grill-with-docs` to populate them.
>
> `packages/platform/redis/` has no `ADAPTER.md`: no app depends on it directly. It arrives with the packages that do, and the obligations it passes on are stated in theirs.
>
> `packages/shared/ui/` owns ADRs and no `CONTEXT.md`. An ADR directory and a glossary are independent.
