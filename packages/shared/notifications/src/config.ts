import { z } from 'zod';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Notifications config-as-code (ADR 0026). The stream TTL and the reader's idle
 * backoff bounds are operational tunables that can differ per deploy target, so
 * they live here rather than hardcoded in the service layer. All server-side —
 * `publish` and `tailNotifications` run on the backend.
 */
export function notificationsConfig(context: ConfigContext) {
  return createConfig({
    server: {
      // Rolling TTL (seconds) refreshed on every `publish`. No MAXLEN — a stream
      // with no reader simply expires. Delivery is best-effort (ADR 0030): a
      // publish with no page open is never delivered.
      NOTIFICATION_TTL: z.coerce.number().int().positive(),
      // Reader idle backoff (ms): starts at MIN, doubles up to MAX while the
      // stream is empty, snaps back to MIN on the first new entry.
      POLL_MIN_MS: z.coerce.number().int().positive(),
      POLL_MAX_MS: z.coerce.number().int().positive(),
    },
    profiles: {
      default: {
        server: {
          NOTIFICATION_TTL: 3600,
          POLL_MIN_MS: 100,
          POLL_MAX_MS: 1000,
        },
      },
    },
    context,
  });
}
