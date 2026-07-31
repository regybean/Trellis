import 'server-only';

import { randomUUID } from 'node:crypto';

import { redis } from '@acme/redis';

import type { PublishInput } from '../schemas/notification-schema';
import { notificationsConfig } from '../../config';
import { appEnv } from '../../env';
import { notificationKey } from '../notification-keys';
import {
  notificationSchema,
  publishInputSchema,
} from '../schemas/notification-schema';

const config = notificationsConfig({ appEnv, isServer: true });

/**
 * The SOLE writer of a user's notification stream — the one place `xAdd` is
 * called for notifications (mirrors chat's stream-writer discipline). It:
 *
 *   1. validates `input` against the envelope schema (a feature typo throws here,
 *      not at the reader);
 *   2. mints the two server-owned fields — `id` (`randomUUID`, becomes the
 *      react-toastify `toastId`) and `createdAt` (server clock);
 *   3. writes the whole envelope as a single `payload` JSON field (the nested
 *      `data` object can't be a flat field map); and
 *   4. refreshes a rolling TTL so an unread stream simply expires (no MAXLEN,
 *      nothing ever deletes the key).
 *
 * There is deliberately NO core "kind factory": a feature writes its own typed
 * one-line wrapper around `publish` (ingest's `notifyJobComplete`). Delivery is
 * best-effort — a publish with no reader attached is never seen (ADR 0030).
 */
export async function publish(userId: string, input: PublishInput) {
  const parsed = publishInputSchema.parse(input);
  const notification = notificationSchema.parse({
    ...parsed,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });

  const key = notificationKey(userId);
  await redis.xAdd(key, '*', { payload: JSON.stringify(notification) });
  await redis.expire(key, config.NOTIFICATION_TTL);
}
