# Mounting `@acme/entitlements`

An app mounts this by putting an `EntitlementsProvider` on the tRPC context it
hands each feature's `createTRPCContext`. This package ships the types plus one
concrete provider — `unlimitedEntitlements` — for apps that have no billing.

The dependency arrows are worth reading before the snippets: the **slim** apps
depend on `@acme/entitlements` directly and the full apps do not. A full app gets
its provider from `@acme/subscriptions` instead (Stripe/Redis-backed), so it never
imports this package by name.

## Mounted by

- `apps/nextjs-slim` — `src/server/trpc-route.ts`, `worker.ts`
- `apps/tanstack-slim` — `src/lib/trpc-route.ts`, `worker.ts`
- `apps/nextjs` / `apps/tanstack-start` — indirectly, through
  `createSubscriptionsEntitlements` (see `@acme/subscriptions`'s `ADAPTER.md`)

## Glue

### Inject the no-op provider — `apps/nextjs-slim/src/server/trpc-route.ts`

```ts
import type { InjectedSession } from '@acme/trpc';
import { unlimitedEntitlements } from '@acme/entitlements';

/**
 * Constant local principal. This app strips auth, but the feature procedures
 * still require a principal: `@acme/chat` is `protectedProcedure` (scopes Mastra
 * memory by a non-null principal) and `@acme/ingest` is `adminProcedure` (gates
 * on the principal's `role`). So we inject a single fixed admin user — the whole
 * session, with no provider behind it. See ADR-0006 and ADR-0010.
 */
const LOCAL_SESSION: InjectedSession = {
  user: { id: 'local', role: 'admin' },
};

const resolveContext = (req: Request) => ({
  headers: req.headers,
  req,
  session: LOCAL_SESSION,
  entitlements: unlimitedEntitlements,
});
```

### The worker needs the same provider — `apps/nextjs-slim/worker.ts`

```ts
import { createChatGenerationProcessor } from '@acme/chat/server';
import { unlimitedEntitlements } from '@acme/entitlements';
import { createWorker, QUEUE_NAMES } from '@acme/queue';

const worker = createWorker(
  QUEUE_NAMES.GENERATION,
  createChatGenerationProcessor(unlimitedEntitlements),
);
```

Route handler and worker must inject the **same** provider, or a Turn is charged
in one process and refunded against a different ledger in the other.

### Swapping in your own

`EntitlementsProvider` is the whole contract. An app with its own billing
implements that interface and passes it in exactly where the snippets above pass
`unlimitedEntitlements` — the features never learn which one is mounted
(ADR 0006).

## Env

Factory: none. `@acme/entitlements` reads no environment.

## Infra

None — no `acme.infra`. `unlimitedEntitlements` is in-memory: no Redis, no
Postgres, no network. That is why a slim app starts neither.

## Also mount

Nothing. `@acme/entitlements` has no dependencies at all.
