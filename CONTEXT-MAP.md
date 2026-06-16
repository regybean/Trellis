# Context Map

This monorepo uses per-package `CONTEXT.md` files for domain language and `docs/adr/` for architectural decisions.

## System-wide

- ADRs: [`docs/adr/`](docs/adr/)

## Packages

| Package | Context | ADRs |
| --- | --- | --- |
| `packages/platform/trpc/` | [`packages/platform/trpc/CONTEXT.md`](packages/platform/trpc/CONTEXT.md) | [`packages/platform/trpc/docs/adr/`](packages/platform/trpc/docs/adr/) |
| `packages/platform/subscriptions/` | [`packages/platform/subscriptions/CONTEXT.md`](packages/platform/subscriptions/CONTEXT.md) | — |
| `packages/shared/models/` | [`packages/shared/models/CONTEXT.md`](packages/shared/models/CONTEXT.md) | [`docs/adr/0003-multi-provider-models.md`](docs/adr/0003-multi-provider-models.md) |
| `packages/shared/rag/` | [`packages/shared/rag/CONTEXT.md`](packages/shared/rag/CONTEXT.md) | — |
| `packages/features/billing/` | [`packages/features/billing/CONTEXT.md`](packages/features/billing/CONTEXT.md) | — |
| `packages/features/chat/` | [`packages/features/chat/CONTEXT.md`](packages/features/chat/CONTEXT.md) | [`packages/features/chat/docs/adr/`](packages/features/chat/docs/adr/) |
| `packages/features/feedback/` | [`packages/features/feedback/CONTEXT.md`](packages/features/feedback/CONTEXT.md) | [`packages/features/feedback/docs/adr/`](packages/features/feedback/docs/adr/) |
| `packages/features/ingest/` | [`packages/features/ingest/CONTEXT.md`](packages/features/ingest/CONTEXT.md) | — |
| `packages/compositions/admin/` | [`packages/compositions/admin/CONTEXT.md`](packages/compositions/admin/CONTEXT.md) | — |
| `packages/compositions/sidebar/` | [`packages/compositions/sidebar/CONTEXT.md`](packages/compositions/sidebar/CONTEXT.md) | — |

## Apps

| App | Context | ADRs |
| --- | --- | --- |
| `apps/nextjs/` | [`apps/nextjs/CONTEXT.md`](apps/nextjs/CONTEXT.md) | — |
| `apps/tanstack-start/` | [`apps/tanstack-start/CONTEXT.md`](apps/tanstack-start/CONTEXT.md) | [`docs/adr/0003-framework-agnostic-auth-seam.md`](docs/adr/0003-framework-agnostic-auth-seam.md), [`docs/adr/0005-telemetry-init-seam.md`](docs/adr/0005-telemetry-init-seam.md) |

> Add rows as you create context files. Run `/grill-with-docs` to populate them.
