import 'server-only';

import { randomUUID } from 'node:crypto';

import type { PublishInput } from '../schemas/notification-schema';
import {
  notificationSchema,
  publishInputSchema,
} from '../schemas/notification-schema';
import { notificationStream } from './notification-stream';

/**
 * The SOLE writer of a user's notification stream — the one place the stream is
 * appended to for notifications (mirrors chat's writer discipline). It:
 *
 *   1. validates `input` against the envelope schema (a feature typo throws here,
 *      not at the reader);
 *   2. mints the two server-owned fields — `id` (`randomUUID`, becomes the
 *      react-toastify `toastId`) and `createdAt` (server clock); and
 *   3. hands the envelope to the durable stream, which encodes it as a single
 *      `payload` JSON field and appends it with an atomically-restamped rolling
 *      TTL (`xAddWithTtl`) — so an unread stream simply expires, and a crash can
 *      never split the append from the TTL and leave the key immortal (the
 *      non-atomic `xAdd`+`expire` this replaced, #196).
 *
 * There is deliberately NO core "kind factory": a feature writes its own typed
 * one-line wrapper around `publish` (ingest's `notifyJobComplete`). Delivery is
 * best-effort — a publish with no reader attached is never seen (ADR 0001).
 */
export async function publish(userId: string, input: PublishInput) {
  const parsed = publishInputSchema.parse(input);
  const notification = notificationSchema.parse({
    ...parsed,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });

  await notificationStream(userId).write(notification);
}
