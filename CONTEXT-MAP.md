# Context Map

This monorepo uses per-package `CONTEXT.md` files for domain language and `docs/adr/` for architectural decisions.

## System-wide

- ADRs: [`docs/adr/`](docs/adr/)
- Package `exports` convention: [`docs/adr/0015-package-exports-convention.md`](docs/adr/0015-package-exports-convention.md) (enforced by `scripts/check-exports.mjs` via `pnpm lint`)

## Packages

| Package                            | Context                                                                                    | ADRs                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/platform/trpc/`          | [`packages/platform/trpc/CONTEXT.md`](packages/platform/trpc/CONTEXT.md)                   | [`packages/platform/trpc/docs/adr/`](packages/platform/trpc/docs/adr/), [`docs/adr/0006-entitlements-injection-seam.md`](docs/adr/0006-entitlements-injection-seam.md) |
| `packages/platform/entitlements/`  | [`packages/platform/entitlements/CONTEXT.md`](packages/platform/entitlements/CONTEXT.md)   | [`docs/adr/0006-entitlements-injection-seam.md`](docs/adr/0006-entitlements-injection-seam.md)                                                                         |
| `packages/platform/subscriptions/` | [`packages/platform/subscriptions/CONTEXT.md`](packages/platform/subscriptions/CONTEXT.md) | [`docs/adr/0006-entitlements-injection-seam.md`](docs/adr/0006-entitlements-injection-seam.md)                                                                         |
| `packages/platform/queue/`         | [`packages/platform/queue/CONTEXT.md`](packages/platform/queue/CONTEXT.md)                 | —                                                                                                                                                                      |
| `packages/platform/redis/`         | [`packages/platform/redis/CONTEXT.md`](packages/platform/redis/CONTEXT.md)                 | [`docs/adr/0008-per-app-redis-namespace.md`](docs/adr/0008-per-app-redis-namespace.md)                                                                                 |
| `packages/platform/db/`            | [`packages/platform/db/CONTEXT.md`](packages/platform/db/CONTEXT.md)                       | [`docs/adr/0016-db-connection-platform-package.md`](docs/adr/0016-db-connection-platform-package.md)                                                                   |
| `packages/platform/config/`        | [`packages/platform/config/CONTEXT.md`](packages/platform/config/CONTEXT.md)               | [`docs/adr/0026-config-as-code.md`](docs/adr/0026-config-as-code.md)                                                                                                   |
| `packages/shared/hooks/`           | [`packages/shared/hooks/CONTEXT.md`](packages/shared/hooks/CONTEXT.md)                     | [`docs/adr/0025-per-query-indexeddb-persister.md`](docs/adr/0025-per-query-indexeddb-persister.md)                                                                     |
| `packages/shared/models/`          | [`packages/shared/models/CONTEXT.md`](packages/shared/models/CONTEXT.md)                   | [`docs/adr/0003-multi-provider-models.md`](docs/adr/0003-multi-provider-models.md)                                                                                     |
| `packages/shared/rag/`             | [`packages/shared/rag/CONTEXT.md`](packages/shared/rag/CONTEXT.md)                         | [`docs/adr/0002-mastra-rag-and-memory.md`](docs/adr/0002-mastra-rag-and-memory.md)                                                                                     |
| `packages/features/billing/`       | [`packages/features/billing/CONTEXT.md`](packages/features/billing/CONTEXT.md)             | —                                                                                                                                                                      |
| `packages/features/chat/`          | [`packages/features/chat/CONTEXT.md`](packages/features/chat/CONTEXT.md)                   | [`packages/features/chat/docs/adr/`](packages/features/chat/docs/adr/)                                                                                                 |
| `packages/features/feedback/`      | [`packages/features/feedback/CONTEXT.md`](packages/features/feedback/CONTEXT.md)           | [`packages/features/feedback/docs/adr/`](packages/features/feedback/docs/adr/)                                                                                         |
| `packages/features/ingest/`        | [`packages/features/ingest/CONTEXT.md`](packages/features/ingest/CONTEXT.md)               | —                                                                                                                                                                      |

## Tooling

| Package               | Context                                                          | ADRs                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tooling/test-utils/` | [`tooling/test-utils/CONTEXT.md`](tooling/test-utils/CONTEXT.md) | [`docs/adr/0014-tests-validate-real-env.md`](docs/adr/0014-tests-validate-real-env.md), [`docs/adr/0017-test-infra-owned-by-infra-package.md`](docs/adr/0017-test-infra-owned-by-infra-package.md) |

## Apps

| App                    | Context                                                            | ADRs                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/nextjs/`         | [`apps/nextjs/CONTEXT.md`](apps/nextjs/CONTEXT.md)                 | —                                                                                                                                                                                                                                                                                                |
| `apps/nextjs-slim/`    | [`apps/nextjs-slim/CONTEXT.md`](apps/nextjs-slim/CONTEXT.md)       | [`docs/adr/0006-entitlements-injection-seam.md`](docs/adr/0006-entitlements-injection-seam.md), [`docs/adr/0010-slim-no-auth-apps.md`](docs/adr/0010-slim-no-auth-apps.md)                                                                                                                       |
| `apps/tanstack-start/` | [`apps/tanstack-start/CONTEXT.md`](apps/tanstack-start/CONTEXT.md) | [`docs/adr/0003-framework-agnostic-auth-seam.md`](docs/adr/0003-framework-agnostic-auth-seam.md), [`docs/adr/0005-telemetry-init-seam.md`](docs/adr/0005-telemetry-init-seam.md), [`docs/adr/0023-ambient-telemetry-no-context-object.md`](docs/adr/0023-ambient-telemetry-no-context-object.md) |
| `apps/tanstack-slim/`  | [`apps/tanstack-slim/CONTEXT.md`](apps/tanstack-slim/CONTEXT.md)   | [`docs/adr/0006-entitlements-injection-seam.md`](docs/adr/0006-entitlements-injection-seam.md), [`docs/adr/0010-slim-no-auth-apps.md`](docs/adr/0010-slim-no-auth-apps.md)                                                                                                                       |

> Add rows as you create context files. Run `/grill-with-docs` to populate them.
