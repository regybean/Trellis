/**
 * Generation worker — @acme/tanstack-start.
 *
 * A long-lived Node process that drains the BullMQ `generation` queue and runs
 * @acme/chat's `chatGenerationProcessor`. It has NO HTTP listener: it is purely
 * a background consumer of the queue that `chat.send` enqueues to.
 *
 * NOT a docker-compose service. It runs as a turbo dev-graph task (see
 * `turbo.json` — the `dev` task lists `dev:worker` under `with`, so `pnpm dev`
 * spawns it alongside `vite dev`). The rationale is per-app namespace isolation:
 * this worker inherits this app's env (`NEXT_PUBLIC_WEBAPP`), so it targets this
 * app's own Redis namespace (via `@acme/redis`'s `nsKey`), its own BullMQ queue
 * prefix (via `@acme/queue`), and its own Postgres schema (via `@acme/rag`). A
 * single shared compose service would have to inject each app's env by hand —
 * fragile — so the isolation maps naturally to one process per app instead. See
 * chat ADR 0004.
 *
 * Runtime note: launched with `tsx --conditions=react-server` (see the
 * `dev:worker` script) so `@acme/chat/server`'s `import 'server-only'` resolves
 * to its empty stub rather than the guard that throws outside an RSC bundle.
 */

import { chatGenerationProcessor } from '@acme/chat/server';
import { logger } from '@acme/logger';
import { createWorker, QUEUE_NAMES } from '@acme/queue';

const worker = createWorker(QUEUE_NAMES.GENERATION, chatGenerationProcessor);

logger.info(
  { queue: QUEUE_NAMES.GENERATION, app: 'tanstack-start' },
  'generation worker: online',
);

// Drain in flight before exiting so a redeploy/Ctrl-C does not orphan a Turn.
async function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'generation worker: shutting down');
  await worker.close();
  // Daemon entrypoint, not a library: the db/redis pools @acme/chat opens keep
  // the event loop alive, so exit explicitly once BullMQ has drained.
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
