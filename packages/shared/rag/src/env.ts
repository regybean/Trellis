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
      // AWS Bedrock — region + Claude chat model id (eu-west-2 inference profile).
      AWS_REGION: z.string().nonempty().default('eu-west-2'),
      BEDROCK_CHAT_MODEL: z.string().nonempty(),
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
      AWS_REGION: process.env.AWS_REGION,
      BEDROCK_CHAT_MODEL: process.env.BEDROCK_CHAT_MODEL,
    },
    skipValidation:
      !!process.env.CI || process.env.npm_lifecycle_event === 'lint',
  });
}

export const env = ragEnv();
