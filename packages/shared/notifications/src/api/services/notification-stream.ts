import type { StreamCodec, StreamEntry } from '@acme/redis';
import { createDurableStream, HEAD_CURSOR } from '@acme/redis';

import type { Notification } from '../schemas/notification-schema';
import { notificationsConfig } from '../../config';
import { configContext } from '../../env';
import { notificationKey } from '../notification-keys';
import { notificationSchema } from '../schemas/notification-schema';

// The per-user notification Stream, on the shared `@acme/redis` durable-stream
// primitive (#196). The primitive owns the transport — the XRANGE poll loop with
// idle backoff, the abort-aware poll `delay`, the exclusive cursor, atomic
// append-with-TTL, and the "last stream id" read — that notifications used to
// hand-copy alongside chat and ingest (and where the two fixes ingest already
// shipped, atomic TTL + a real-id fresh-connect seed, had never propagated). What
// stays here is only notifications' own: the wire codec and the tail-from-now
// cursor-seed policy. Config-as-code (ADR 0026).
const config = notificationsConfig(configContext);

// `publish` writes the whole envelope as a single `payload` JSON field — the
// nested `data` object can't be a flat field map. Decode is the inverse: the
// primitive folds the raw field array to a record and hands it here; pull
// `payload`, JSON.parse, validate. A missing `payload` (producer bug) throws.
const codec: StreamCodec<Notification> = {
  encode: (notification) => ({ payload: JSON.stringify(notification) }),
  decode: (fields) => {
    const payload = fields.payload;
    if (payload === undefined) {
      throw new Error(
        'notification stream entry is missing its `payload` field',
      );
    }
    return notificationSchema.parse(JSON.parse(payload));
  },
};

export const decodeNotification = codec.decode;

// One user's durable notification Stream. No MAXLEN — an unread stream simply
// expires on the rolling TTL (re)stamped atomically with every append.
export const notificationStream = (userId: string) =>
  createDurableStream<Notification>({
    key: notificationKey(userId),
    ttlSeconds: config.NOTIFICATION_TTL,
    codec,
  });

export type NotificationEntry = StreamEntry<Notification>;

// Pure, stateless tail of a user's notification stream — no writes, no lock, no
// terminal, no coalescing (each entry is a discrete, independent notification).
// The only exit is client abort.
//
// The seed is captured EAGERLY here (not lazily on first pull), so it reflects
// the stream at attach time:
//   - fresh connect (no `lastEventId`) ⇒ TAIL-FROM-NOW seeded from the stream's
//     ACTUAL last id (`lastId()`, a real Redis-assigned id). Every later entry
//     has a strictly greater id, so the tail skips the whole backlog — a
//     leave-and-return shows nothing (the ADR 0030 no-durability contract). This
//     replaces the old `${Date.now()}-0` seed, which read the app clock while
//     Redis assigns ids from its own: under podman-VM drift that landed in Redis'
//     future and silently dropped live entries. A real id cannot skew.
//   - transient reconnect ⇒ tRPC replays the last delivered id as `lastEventId`;
//     the exclusive resume means the client never re-toasts an entry.
//   - empty stream ⇒ the head, so the first-ever entry is delivered.
export async function tailNotifications(
  userId: string,
  lastEventId: string | null,
  signal?: AbortSignal,
) {
  const stream = notificationStream(userId);
  const seed = lastEventId ?? (await stream.lastId()) ?? HEAD_CURSOR;
  return stream.tail(seed, {
    pollMinMs: config.POLL_MIN_MS,
    pollMaxMs: config.POLL_MAX_MS,
    signal,
  });
}
