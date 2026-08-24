import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, webappSchema, withProfiles } from '@acme/env';

import { REDIS_DEVELOPMENT_PROFILE } from './development-profile';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * The Redis connection and this slice's selectors, declared once (ADR 0033).
 *
 * **Config** — `REDIS_URL` carries a profile value, so a clean checkout with no
 * `.env` row connects to the local stack, and it is env-overridable like every
 * other key (ADR 0033 §4): a testcontainer hands back a mapped port and a prod
 * endpoint is infra-injected, neither of which a profile can know. The
 * hand-rolled `process.env.REDIS_URL ?? config.REDIS_URL` this replaced skipped
 * validation; the override is now re-checked as a URL like the authored value.
 *
 * **Selectors** — `NEXT_PUBLIC_WEBAPP` (app identity, which partitions every
 * shared datastore) and `NODE_ENV` stay written longhand: they are the keys a
 * bundler inlines textually, and an index access is invisible to that.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  shared: {
    NODE_ENV: z.enum(['development', 'production', 'test']),
    // App identity — partitions every shared datastore per app. Mirrors the
    // per-app Postgres schema (see @acme/rag env). Drives the Redis key prefix so
    // the two apps never collide on one shared Redis instance. The
    // Postgres-identifier constraint is `webappSchema`'s.
    NEXT_PUBLIC_WEBAPP: webappSchema,
  },
  server: {
    REDIS_URL: z.url(),
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: { ...REDIS_DEVELOPMENT_PROFILE, NODE_ENV: 'development' },
    }),
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
    REDIS_URL: readEnv('REDIS_URL'),
  },
  emptyStringAsUndefined: true,
});
