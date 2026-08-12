import { redis } from '@acme/redis';

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
// `lastEventId`) resumes strictly after it. On a FRESH mount the cursor is the
// snapshot's `lastId` (`sinceId`) — the client seeds its rows from
// `documents.progressSnapshot` then resumes the tail strictly after that id, so
// prior in-flight progress survives a refresh (snapshot → resume-from-lastId,
// #194). There is NO `Date.now()` cursor: it read the app server's clock while
// Redis assigns ids from its own, so under clock skew a "tail from now" silently
// dropped every real stage event — a real Stream id can't skew. Absent both ids
// the cursor is the head (`0-0`), whose exclusive start reads any later append.
// The generator closes ONLY on abort; the parse / cursor logic is the pure seam in
// ingest-progress-parser.ts.
export async function* tailIngestProgress(
  userId: string,
  cursor: { lastEventId?: string | null; sinceId?: string | null },
  signal?: AbortSignal,
) {
  const key = ingestProgressKey(userId);
  // Reconnect resumes from tRPC's `lastEventId`; a fresh mount from the snapshot's
  // `lastId`; absent both, the stream head — every branch is a real Redis id.
  let cursorId = cursor.lastEventId ?? cursor.sinceId ?? '0-0';
  let idleMs = config.INGEST_PROGRESS_POLL_MIN_MS;

  while (!signal?.aborted) {
    const entries = await redis.xRange(key, rangeStart(cursorId), '+');

    for (const [id, fields] of entries) {
      cursorId = id;
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
