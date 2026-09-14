import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, webappSchema, withProfiles } from '@acme/env';

import { REDIS_DEVELOPMENT_PROFILE } from './development-profile';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * The Redis connection and this slice's selectors, declared once.
 *
 * **Config** — `REDIS_URL` carries a profile value, so a clean checkout with no
 * `.env` row connects to the local stack, and it is env-overridable like every
 * other key: a testcontainer hands back a mapped port and a prod endpoint is
 * infra-injected, neither of which a profile can know. The hand-rolled
 * `process.env.REDIS_URL ?? config.REDIS_URL` this replaced skipped validation;
 * the override is now re-checked as a URL like the authored value. On a deploy
 * target it is **unauthored** and therefore demanded: the DSN is an address and
 * carries its own credentials, so there is nothing a profile could honestly say
 * ([@acme/env ADR 0003](../../env/docs/adr/0003-a-deploy-target-authors-its-own-profile.md)).
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
      // The DSN is an address, and it carries the credentials with it, so there
      // is nothing here a profile could honestly author for a deploy target.
      // Unauthoring makes it a secret on both, and a deploy that forgets to
      // inject it crashes at boot naming `REDIS_URL`.
      staging: { REDIS_URL: undefined },
      production: { REDIS_URL: undefined },
    }),
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
    REDIS_URL: readEnv('REDIS_URL'),
  },
  emptyStringAsUndefined: true,
});
