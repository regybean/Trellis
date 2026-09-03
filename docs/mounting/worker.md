# Recipe: the worker entrypoint

Features that do work outside a request enqueue a job and return. Something has
to drain the queue. That something is a long-lived process your app owns, and
each such feature exports a processor for it.

## 1. The process

```ts
import { createWorker, QUEUE_NAMES } from "@acme/queue";

const worker = createWorker(QUEUE_NAMES.GENERATION, createChatProcessor(deps));
```

One process can drain several queues — a second `createWorker` call costs no
extra process, and rides the same env. It has no HTTP listener; it is purely a
consumer.

Queue names come from `QUEUE_NAMES`, never a string literal. The queue prefix is
derived from your app's identity, so two apps on one Redis do not consume each
other's jobs.

## 2. It is your app's process, not a service

The worker inherits your app's environment, which is what keeps it pointed at
your app's Redis namespace, queue prefix and Postgres schema. Run it as a task
in your app's dev graph and as a process in your deployment, alongside the web
process. A single shared worker service for several apps would have to inject
each app's env by hand.

## 3. Inject from your app's composition root

A processor that charges or refunds credits needs the `EntitlementsProvider`
your route seam uses ([trpc-route.md](trpc-route.md)) — the same value, not an
identically written second one. A job failure that refunds through a different
provider refunds a ledger nobody is reading, and both versions typecheck.

So the app builds it once, in `src/server/deps.ts`, and both entry points import
the result. Lint keeps the factories out of every other file in the app
([ADR 0006](../adr/0006-entitlements-injection-seam.md)).

```ts
import { entitlements } from "./src/server/deps";

createWorker(QUEUE_NAMES.GENERATION, createChatProcessor(entitlements));
```

Processors that neither read nor write entitlements take no arguments. The
feature's `ADAPTER.md` says which kind it exports.

## 4. Shut down gracefully

Close the workers before exiting so a redeploy does not orphan in-flight work.

```ts
const shutdown = async () => {
  await Promise.all([worker.close()]);
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
```

The explicit exit is deliberate: the database and Redis pools a feature opens
keep the event loop alive after the queue has drained.

## 5. Server-only imports in a plain Node process

A feature's `./server` subpath is marked `import 'server-only'`. Outside a
framework's server bundle that marker can throw, so a bare Node process needs
its resolver told to pick the server condition — in this repo the worker scripts
pass `--conditions=react-server`. Your framework may differ; the symptom is a
`server-only` error thrown at import time.
