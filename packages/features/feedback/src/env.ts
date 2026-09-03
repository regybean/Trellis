import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { resolveAppEnv, webappSchema, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Feedback's environment (@acme/env ADR 0001). Selectors only — the slice has no tunables
 * and no secrets of its own. Both keys stay written longhand in `runtimeEnv`:
 * they are the ones a bundler inlines textually, and an index access is invisible
 * to that.
 */
export function feedbackEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    shared: {
      NODE_ENV: z.enum(['development', 'production', 'test']),
      // Per-app identity — Postgres/pgvector schema + Redis prefix.
      NEXT_PUBLIC_WEBAPP: webappSchema,
    },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, { default: { NODE_ENV: 'development' } }),
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
    },
    emptyStringAsUndefined: true,
  });
}

export const env = feedbackEnv();
