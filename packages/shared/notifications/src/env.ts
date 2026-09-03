import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Notifications' environment, declared once (@acme/env ADR 0001). The stream TTL and the
 * reader's idle backoff bounds are operational tunables that can differ per
 * deploy target, so they are authored here as profile values rather than
 * hardcoded in the service layer — and each is env-overridable (@acme/env ADR 0001 §4), so
 * a noisy deploy can be retuned without a rebuild. All server-side: `publish` and
 * `tailNotifications` run on the backend.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  shared: {
    NODE_ENV: z.enum(['development', 'production', 'test']),
  },
  server: {
    // Rolling TTL (seconds) refreshed on every `publish`. No MAXLEN — a stream
    // with no reader simply expires. Delivery is best-effort (ADR 0001): a
    // publish with no page open is never delivered.
    NOTIFICATION_TTL: z.coerce.number().int().positive(),
    // Reader idle backoff (ms): starts at MIN, doubles up to MAX while the
    // stream is empty, snaps back to MIN on the first new entry.
    POLL_MIN_MS: z.coerce.number().int().positive(),
    POLL_MAX_MS: z.coerce.number().int().positive(),
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: {
        NODE_ENV: 'development',
        NOTIFICATION_TTL: 3600,
        POLL_MIN_MS: 100,
        POLL_MAX_MS: 1000,
      },
    }),
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NOTIFICATION_TTL: readEnv('NOTIFICATION_TTL'),
    POLL_MIN_MS: readEnv('POLL_MIN_MS'),
    POLL_MAX_MS: readEnv('POLL_MAX_MS'),
  },
  emptyStringAsUndefined: true,
});
