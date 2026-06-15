import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

function ragEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      NEXT_PUBLIC_WEBAPP: z.string().nonempty(),
    },
    server: {
      DB_HOST: z.string().nonempty(),
      DB_PORT: z.coerce.number(),
      DB_USER: z.string().nonempty(),
      DB_PASSWORD: z.string().nonempty(),
      // App database — Mastra Memory (threads/messages/resources) lives here.
      DB_NAME: z.string().nonempty(),
      // Dedicated vector database — the knowledge base lives here.
      DB_VECTOR_NAME: z.string().nonempty(),
      CHUNK_SIZE: z.coerce.number().default(1024),
      CHUNK_OVERLAP: z.coerce.number().default(20),
    },
    client: {},
    runtimeEnv: {
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      NODE_ENV: process.env.NODE_ENV,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DB_NAME: process.env.DB_NAME,
      // Use the dedicated vector database name; do NOT alias to DB_NAME
      DB_VECTOR_NAME: process.env.DB_VECTOR_NAME,
      CHUNK_OVERLAP: process.env.CHUNK_OVERLAP,
      CHUNK_SIZE: process.env.CHUNK_SIZE,
    },
    skipValidation:
      !!process.env.CI ||
      process.env.npm_lifecycle_event === 'lint' ||
      process.env.NEXT_PHASE === 'phase-production-build',
  });
}

export const env = ragEnv();
