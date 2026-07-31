import type { Notification } from '../schemas/notification-schema';
import { notificationSchema } from '../schemas/notification-schema';

// The pure core of the reader: decoding a raw Redis Stream entry back into a
// validated `Notification`. No Redis I/O here, so a unit test can cross the seam
// with plain field arrays. `publish` writes the whole envelope as a single
// `payload` JSON field (the nested `data` object can't be a flat field map), so
// decoding is the inverse: pull `payload`, JSON.parse, validate through the
// shared schema — the exact round-trip `publish` produces.

// A raw Redis Stream entry as ioredis' `xRange` yields it: an `[id, fields]`
// tuple whose fields are a flat [k, v, k, v, ...] array.
export type RawNotificationEntry = readonly [id: string, fields: string[]];

// A parsed entry ready for the router: the stream `id` (handed to tRPC
// `tracked()` as the SSE resume cursor) and the validated envelope.
export interface NotificationEntry {
  id: string;
  notification: Notification;
}

// Decode the flat [k, v, ...] field array of one entry. `publish` writes exactly
// one field, `payload`; anything else is a producer bug and throws here (a
// missing `payload`, or a payload that fails schema validation) rather than
// silently yielding a malformed toast.
export function parseEntry(fields: string[]): Notification {
  const rec = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) rec.set(key, value);
  }
  const payload = rec.get('payload');
  if (payload === undefined) {
    throw new Error('notification stream entry is missing its `payload` field');
  }
  return notificationSchema.parse(JSON.parse(payload));
}
