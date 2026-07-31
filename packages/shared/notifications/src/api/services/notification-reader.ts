import { redis } from '@acme/redis';

import type { NotificationEntry } from './notification-parser';
import { notificationsConfig } from '../../config';
import { appEnv } from '../../env';
import { notificationKey } from '../notification-keys';
import { parseEntry } from './notification-parser';

const config = notificationsConfig({ appEnv, isServer: true });

// A delay that also settles early on abort, so a disconnecting client tears the
// reader down within one tick rather than after the full backoff interval.
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

// Pure, stateless tail of a user's notification stream — no writes, no lock, no
// terminal. Yields each Redis entry as `{ id, notification }`; the router hands
// `id` to tRPC `tracked()` so a reconnecting client (passing `lastEventId`)
// resumes strictly after it.
//
// It NEVER self-closes: notifications are long-lived (one stream across all of a
// user's jobs), so the only exit is client abort. Unlike chat's reader there is
// no in-flight lock to probe and no coalescing (each entry is a discrete,
// independent notification).
//
// Cursor policy:
//   - fresh connect (no `lastEventId`) ⇒ TAIL-FROM-NOW: seed the cursor to
//     `${Date.now()}-0`. Every entry added later has a strictly greater id, so
//     the exclusive `(cursor` range below skips the whole backlog — a
//     leave-and-return shows nothing, which is the accepted no-durability
//     contract (ADR 0030). No xRevRange, no new @acme/redis surface.
//   - transient reconnect ⇒ tRPC replays the last `tracked` id as `lastEventId`;
//     the exclusive `(cursor` resume means the client never re-reads an entry it
//     already toasted.
//
// Idle backoff: doubles POLL_MIN_MS→POLL_MAX_MS while the stream is empty, snaps
// back to POLL_MIN_MS on the first new entry.
export async function* tailNotifications(
  userId: string,
  lastEventId: string | null,
  signal?: AbortSignal,
): AsyncGenerator<NotificationEntry, void> {
  const key = notificationKey(userId);
  let cursor = lastEventId ?? `${Date.now()}-0`;
  let idleMs = config.POLL_MIN_MS;

  while (!signal?.aborted) {
    // Exclusive `(cursor`: strictly after the last seen id, so neither the
    // tail-from-now seed nor a resume cursor re-yields an entry.
    const entries = await redis.xRange(key, `(${cursor}`, '+');

    if (entries.length > 0) {
      idleMs = config.POLL_MIN_MS;
      for (const [id, fields] of entries) {
        cursor = id;
        yield { id, notification: parseEntry(fields) };
      }
      continue;
    }

    await delay(idleMs, signal);
    idleMs = Math.min(idleMs * 2, config.POLL_MAX_MS);
  }
}
