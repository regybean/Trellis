import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

export function ingestEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      NEXT_PUBLIC_WEBAPP: z.string().nonempty(),
    },
    server: {
      AWS_REGION: z.string().default('eu-west-2'),
      AWS_ACCESS_KEY_ID: z.string(),
      AWS_SECRET_ACCESS_KEY: z.string(),
      // Optional override for LocalStack in development (e.g. http://localhost:4566)
      S3_ENDPOINT: z.string().optional(),
      S3_UPLOAD_BUCKET: z.string().nonempty(),
    },
    client: {},
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      AWS_REGION: process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      S3_ENDPOINT: process.env.S3_ENDPOINT,
      S3_UPLOAD_BUCKET: process.env.S3_UPLOAD_BUCKET,
    },
    skipValidation:
      !!process.env.CI ||
      process.env.npm_lifecycle_event === 'lint' ||
      process.env.NEXT_PHASE === 'phase-production-build',
  });
}

export const env = ingestEnv();
