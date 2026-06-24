import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

export function feedbackEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      // Per-app identity — Postgres/pgvector schema + Redis prefix. Must be a
      // valid Postgres identifier: lowercase letter then lowercase/digits/underscores.
      NEXT_PUBLIC_WEBAPP: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]*$/,
          'NEXT_PUBLIC_WEBAPP must be a valid Postgres identifier: lowercase letter then lowercase/digits/underscores',
        ),
    },
    server: {
      REDIS_URL: z.url(),
      DB_HOST: z.string().nonempty(),
      DB_PORT: z.coerce.number(),
      DB_USER: z.string().nonempty(),
      DB_PASSWORD: z.string().nonempty(),
      DB_NAME: z.string().nonempty(),
    },
    client: {},
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      REDIS_URL: process.env.REDIS_URL,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DB_NAME: process.env.DB_NAME,
    },
    skipValidation:
      !!process.env.CI ||
      process.env.npm_lifecycle_event === 'lint' ||
      process.env.NEXT_PHASE === 'phase-production-build',
  });
}

export const env = feedbackEnv();
