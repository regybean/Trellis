import { vercel } from '@t3-oss/env-core/presets-zod';
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

function utilsEnv() {
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
      DB_VECTOR_NAME: z.string().nonempty(),
      CHUNK_SIZE: z.coerce.number().default(1024),
      CHUNK_OVERLAP: z.coerce.number().default(20),
      DOCUMENTS_TABLE_NAME: z.string().nonempty().default('documents'),
      LLAMA_CLOUD_API_KEY: z.string(),
    },
    client: {},
    runtimeEnv: {
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      // Use the dedicated vector database name; do NOT alias to DB_NAME
      DB_VECTOR_NAME: process.env.DB_VECTOR_NAME,
      NODE_ENV: process.env.NODE_ENV,
      CHUNK_OVERLAP: process.env.CHUNK_OVERLAP,
      CHUNK_SIZE: process.env.CHUNK_SIZE,
      DOCUMENTS_TABLE_NAME: process.env.DOCUMENTS_TABLE_NAME,
      LLAMA_CLOUD_API_KEY: process.env.LLAMA_CLOUD_API_KEY,
    },
    skipValidation:
      !!process.env.CI || process.env.npm_lifecycle_event === 'lint',
  });
}

export const env = utilsEnv();
