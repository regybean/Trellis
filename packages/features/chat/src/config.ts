import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Chat config-as-code (ADR 0026). The Turn-lifecycle TTLs, the stream poll
 * interval, the per-Turn credit charge, and the BullMQ retention counts were
 * hardcoded across the `api/services` layer; they are operational tunables that
 * can differ per deploy target, so they live here. All server-side — the whole
 * durable-stream control plane runs on the backend / worker.
 *
 * `MAX_MESSAGE_LENGTH` deliberately stays a code constant in `chat-schema.ts`:
 * it is an env-invariant validation limit read in the client-safe schema barrel
 * (ADR 0026 phase 3, "leave structural constants as code").
 */
export function chatConfig(context: ConfigContext) {
  return createConfig({
    server: {
      // Credits charged per Turn — the consume and every refund path read this.
      CREDITS_PER_TURN: z.coerce.number().int().nonnegative(),
      // Turn-lifecycle Redis TTLs (seconds). The in-flight lock doubles as the
      // crash-recovery bound; the abort signal shares it; the post-terminal TTL
      // is a brief net before proactive stream deletion.
      INFLIGHT_LOCK_TTL: z.coerce.number().int().positive(),
      ABORT_SIGNAL_TTL: z.coerce.number().int().positive(),
      STREAM_POST_TERMINAL_TTL: z.coerce.number().int().positive(),
      // Safety TTL the generation worker stamps on the stream key.
      STREAM_SAFETY_TTL: z.coerce.number().int().positive(),
      // Reader poll interval (ms) while draining the durable stream.
      POLL_INTERVAL_MS: z.coerce.number().int().positive(),
      // BullMQ retention: keep the last N completed / failed generation jobs.
      QUEUE_REMOVE_ON_COMPLETE: z.coerce.number().int().nonnegative(),
      QUEUE_REMOVE_ON_FAIL: z.coerce.number().int().nonnegative(),
    },
    profiles: {
      default: {
        server: {
          CREDITS_PER_TURN: 1,
          INFLIGHT_LOCK_TTL: 600,
          ABORT_SIGNAL_TTL: 600,
          STREAM_POST_TERMINAL_TTL: 60,
          STREAM_SAFETY_TTL: 600,
          POLL_INTERVAL_MS: 100,
          QUEUE_REMOVE_ON_COMPLETE: 1000,
          QUEUE_REMOVE_ON_FAIL: 1000,
        },
      },
    },
    context,
  });
}
