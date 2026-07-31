import { redis } from '@acme/redis';

import type { IngestProgressEntry } from './ingest-progress-parser';
import { ingestConfig } from '../../config';
import { appEnv } from '../../env';
import { ingestProgressKey } from '../ingest-keys';
import { parseProgressEntry, rangeStart } from './ingest-progress-parser';

// Reader poll backoff. The reader tails the Redis Stream on the SHARED redis
// connection, so it must never issue a blocking XREAD — that would stall every
// other Redis op in the process. It polls XRANGE with an idle backoff instead
// (min → max, snapping back to min the moment a batch arrives). Config-as-code
// (ADR 0026).
const config = ingestConfig({ appEnv, isServer: true });

// A delay that also settles early on abort, so a disconnecting client tears the
// reader down within one tick rather than after the full poll interval.
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// Page-scoped, always-on tail of a user's progress Stream — no writes, no per-Job
// terminal, no lock/drain. Yields each Redis entry as `{ id, event }`; the router
// hands `id` to tRPC `tracked()` so a transiently-reconnecting client (passing
// `lastEventId`) resumes strictly after it. On a FRESH mount (`lastEventId` null)
// the cursor is seeded to now, so the reader tails from the present — an in-app
// navigate-away-and-back shows blank until the next stage fires (no cross-mount
// resume). The generator closes ONLY on abort; the parse / cursor logic is the
// pure seam in ingest-progress-parser.ts.
export async function* tailIngestProgress(
  userId: string,
  lastEventId: string | null,
  signal?: AbortSignal,
): AsyncGenerator<IngestProgressEntry> {
  const key = ingestProgressKey(userId);
  // Fresh mount ⇒ tail-from-now: any later append has a strictly greater id than
  // `${Date.now()}-0`. A transient reconnect passes the last-seen id instead.
  let cursor = lastEventId ?? `${Date.now()}-0`;
  let idleMs = config.INGEST_PROGRESS_POLL_MIN_MS;

  while (!signal?.aborted) {
    const entries = await redis.xRange(key, rangeStart(cursor), '+');

    for (const [id, fields] of entries) {
      cursor = id;
      yield { id, event: parseProgressEntry(fields) };
    }

    // Snap back to the fast interval when a batch arrived; otherwise back off
    // toward the ceiling so an idle stream is cheap to hold open.
    idleMs =
      entries.length > 0
        ? config.INGEST_PROGRESS_POLL_MIN_MS
        : Math.min(idleMs * 2, config.INGEST_PROGRESS_POLL_MAX_MS);

    await delay(idleMs, signal);
  }
}
