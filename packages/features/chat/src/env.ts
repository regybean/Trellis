import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, webappSchema, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Chat's environment, declared once (@acme/env ADR 0001) — the slice's whole surface in one
 * `createEnv` call, composed into an app's env graph via `extends: [chatEnv(), …]`.
 *
 * **Config** — the Turn-lifecycle TTLs, the stream poll interval, the per-Turn
 * credit charge and the BullMQ retention counts were hardcoded across the
 * `api/services` layer. They are operational tunables that can differ per deploy
 * target, so they are authored here as profile values, and each is
 * env-overridable (@acme/env ADR 0001 §4) — retuning a TTL on a live deploy should not need
 * a rebuild. All server-side: the durable-stream control plane runs on the
 * backend / worker.
 *
 * **Selectors** — `NODE_ENV` and `NEXT_PUBLIC_WEBAPP` (the per-app
 * Postgres/pgvector schema + Redis prefix) stay written longhand in `runtimeEnv`:
 * they are the keys a bundler inlines textually, and an index access is invisible
 * to that.
 *
 * `MAX_MESSAGE_LENGTH` deliberately stays a code constant in `chat-schema.ts`: it
 * is an env-invariant validation limit read in the client-safe schema barrel.
 */
export function chatEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    shared: {
      NODE_ENV: z.enum(['development', 'production', 'test']),
      // Per-app identity — Postgres/pgvector schema + Redis prefix.
      NEXT_PUBLIC_WEBAPP: webappSchema,
    },
    client: {
      // Composed into the query persister's `buster` (with the app-supplied
      // `scopeKey`) so a deploy that changes the persisted data shape discards
      // every prior snapshot on restore. Profile-authored, so an app that doesn't
      // set it gets a stable value which simply never busts on version alone.
      NEXT_PUBLIC_APP_VERSION: z.string(),
    },
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
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, {
        default: {
          NODE_ENV: 'development',
          NEXT_PUBLIC_APP_VERSION: '0.0.0',
          CREDITS_PER_TURN: 1,
          INFLIGHT_LOCK_TTL: 600,
          ABORT_SIGNAL_TTL: 600,
          STREAM_POST_TERMINAL_TTL: 60,
          STREAM_SAFETY_TTL: 600,
          POLL_INTERVAL_MS: 100,
          QUEUE_REMOVE_ON_COMPLETE: 1000,
          QUEUE_REMOVE_ON_FAIL: 1000,
        },
      }),
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
      CREDITS_PER_TURN: readEnv('CREDITS_PER_TURN'),
      INFLIGHT_LOCK_TTL: readEnv('INFLIGHT_LOCK_TTL'),
      ABORT_SIGNAL_TTL: readEnv('ABORT_SIGNAL_TTL'),
      STREAM_POST_TERMINAL_TTL: readEnv('STREAM_POST_TERMINAL_TTL'),
      STREAM_SAFETY_TTL: readEnv('STREAM_SAFETY_TTL'),
      POLL_INTERVAL_MS: readEnv('POLL_INTERVAL_MS'),
      QUEUE_REMOVE_ON_COMPLETE: readEnv('QUEUE_REMOVE_ON_COMPLETE'),
      QUEUE_REMOVE_ON_FAIL: readEnv('QUEUE_REMOVE_ON_FAIL'),
    },
    emptyStringAsUndefined: true,
  });
}

export const env = chatEnv();
