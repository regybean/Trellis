# Mounting `@acme/queue`

An app mounts this by running a **second process**: a `worker.ts` at the app root
that calls `createWorker` for each queue the app's features enqueue to. There is
no route and no provider. If you mount `@acme/chat` or `@acme/ingest` and skip
this file, requests succeed and nothing ever generates or ingests.

## Mounted by

All four apps, each in `worker.ts` (`apps/nextjs/worker.ts`,
`apps/nextjs-slim/worker.ts`, `apps/tanstack-start/worker.ts`,
`apps/tanstack-slim/worker.ts`).

## Glue

### The worker process — `apps/nextjs/worker.ts`

```ts
import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createChatGenerationProcessor } from '@acme/chat/server';
import { createIngestProcessor } from '@acme/ingest/server';
import { logger } from '@acme/logger';
import { createWorker, QUEUE_NAMES } from '@acme/queue';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';

// Inject the SAME provider this app's route handler injects into
// `createTRPCContext` (ADR 0006 / ADR 0010): the Stripe/Redis-backed adapter,
// built from the plan ids billing's own env resolves (ADR 0033), so a worker
// error refunds the real Credit ledger.
const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));
const worker = createWorker(
  QUEUE_NAMES.GENERATION,
  createChatGenerationProcessor(entitlements),
);

// The ingest processor takes no args — it direct-imports its own progress writer
// + the shared `publish`, and neither refunds nor reads entitlements. Second
// worker in the same process = zero new processes (rides this app's env/prefix).
const ingestWorker = createWorker(QUEUE_NAMES.INGEST, createIngestProcessor());
```

Two workers, one process. A second process would buy nothing — both ride the
same app env, so the same Redis namespace, BullMQ prefix and Postgres schema.

### Graceful shutdown — same file

```ts
// Drain in flight before exiting so a redeploy/Ctrl-C does not orphan a Turn.
async function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'workers: shutting down');
  await Promise.all([worker.close(), ingestWorker.close()]);
  // Daemon entrypoint, not a library: the db/redis pools @acme/chat opens keep
  // the event loop alive, so exit explicitly once BullMQ has drained.
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
```

### How the process gets started — `apps/nextjs/package.json`

```json
{
  "dev:worker": "pnpm with-env tsx watch --conditions=react-server worker.ts",
  "start:worker": "pnpm with-env tsx --conditions=react-server worker.ts"
}
```

It is **not** a compose service. The app's own `turbo.json` lists it under the
`dev` task's `with` (and `start:worker` under `start`'s), so `pnpm dev` spawns it
alongside the app:

```json
"dev": { "persistent": true, "with": ["dev:worker"] },
"dev:worker": { "cache": false, "persistent": true }
```

The per-app env is the
reason: a shared container would have to inject each app's `NEXT_PUBLIC_WEBAPP`
by hand.

`--conditions=react-server` is load-bearing, not a flag someone left behind: it
makes `@acme/chat/server`'s `import 'server-only'` resolve to the empty stub
rather than the guard that throws outside an RSC bundle.

### Queue names are constants, not strings

```ts
export const QUEUE_NAMES = {
  GENERATION: 'generation',
  INGEST: 'ingest',
} as const;
```

Producer (`createQueue`, inside the feature) and consumer (`createWorker`, in
your `worker.ts`) must agree — BullMQ identifies a queue by name, so mismatched
literals route silently to the wrong queue. Both take `QueueName`, so a typo is
a compile error.

## Env

Factory: `src/env.ts` (internal — this package has no `./env` export, so an app
does not `extends` it).

| Key                  | Kind     | Notes                             |
| -------------------- | -------- | --------------------------------- |
| `NEXT_PUBLIC_WEBAPP` | selector | becomes the BullMQ key **prefix** |
| `NODE_ENV`           | selector | shared                            |

No tunables of its own — the BullMQ retention counts belong to the features that
enqueue (`QUEUE_REMOVE_ON_COMPLETE` / `QUEUE_REMOVE_ON_FAIL` in `@acme/chat` and
`@acme/ingest`). The connection comes from `@acme/redis`'s `REDIS_URL`, parsed
here rather than declared as a queue env row.

`NEXT_PUBLIC_WEBAPP` is the isolation mechanism: app `nextjs` owns
`nextjs:generation:*` and `tanstack_slim` owns `tanstack_slim:generation:*`. All
apps share one Redis, so an unset value has every worker draining every app's
jobs.

## Infra

`acme.infra: ["redis"]` → the `redis` profile in `deploy/compose.yaml`. BullMQ
opens its own ioredis connections from the same `REDIS_URL`, separate from
`@acme/redis`'s clients.

## Also mount

`@acme/redis` (connection + namespace), `@acme/logger`, `@acme/env`. This is the
only package permitted to depend on `bullmq` — the boundary check enforces it,
so a consumer types its processors as `Job<T>` from this package's re-export
rather than importing BullMQ directly.
