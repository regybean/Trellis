# Context Map

This monorepo uses per-package `CONTEXT.md` files for domain language and `docs/adr/` for architectural decisions.

## System-wide

- ADRs: [`docs/adr/`](docs/adr/)

## Packages

| Package | Context | ADRs |
| --- | --- | --- |
| `packages/shared/trpc/` | [`packages/shared/trpc/CONTEXT.md`](packages/shared/trpc/CONTEXT.md) | [`packages/shared/trpc/docs/adr/`](packages/shared/trpc/docs/adr/) |
| `packages/shared/subscriptions/` | [`packages/shared/subscriptions/CONTEXT.md`](packages/shared/subscriptions/CONTEXT.md) | — |
| `packages/features/billing/` | [`packages/features/billing/CONTEXT.md`](packages/features/billing/CONTEXT.md) | — |
| `packages/features/chat/` | [`packages/features/chat/CONTEXT.md`](packages/features/chat/CONTEXT.md) | — |
| `packages/features/ingest/` | [`packages/features/ingest/CONTEXT.md`](packages/features/ingest/CONTEXT.md) | — |
| `packages/compositions/admin/` | [`packages/compositions/admin/CONTEXT.md`](packages/compositions/admin/CONTEXT.md) | — |
| `packages/compositions/sidebar/` | [`packages/compositions/sidebar/CONTEXT.md`](packages/compositions/sidebar/CONTEXT.md) | — |

## Apps

| App | Context | ADRs |
| --- | --- | --- |
| `apps/nextjs/` | [`apps/nextjs/CONTEXT.md`](apps/nextjs/CONTEXT.md) | — |

> Add rows as you create context files. Run `/grill-with-docs` to populate them.
