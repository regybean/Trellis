import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { resolveAppEnv, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * The tRPC substrate's environment (@acme/env ADR 0001) — one key, and it is a runtime
 * mode rather than a tunable: `withTimingLog` adds an artificial 100-500ms
 * stall in development so local UIs actually render their loading states.
 *
 * It is read here rather than taken as an `isDev` parameter. Every feature used
 * to pass `t._config.isDev`, which made "how do we detect dev" a fact five
 * wirings and the generator template each restated, by reaching into tRPC's
 * private `_config` to learn it (#264, #265 review). Validating it here instead
 * keeps the middleware bodies taking only what they log or decide on, and keeps
 * the read off `process.env` in feature code, where the lint rule rightly bans
 * it.
 *
 * `NODE_ENV` stays written longhand in `runtimeEnv`: it is one of the keys a
 * bundler inlines textually, and an index access is invisible to that.
 */
function trpcEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    shared: {
      NODE_ENV: z.enum(['development', 'production', 'test']),
    },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, { default: { NODE_ENV: 'development' } }),
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
    },
    emptyStringAsUndefined: true,
  });
}

export const env = trpcEnv();
