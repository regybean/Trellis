import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

function ragEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
      // Per-app identity — names the Postgres/pgvector schema. Must be a valid
      // Postgres identifier: lowercase letter, then lowercase/digits/underscores.
      NEXT_PUBLIC_WEBAPP: z
        .string()
        .regex(
          /^[a-z][a-z0-9_]*$/,
          'NEXT_PUBLIC_WEBAPP must be a valid Postgres identifier: lowercase letter then lowercase/digits/underscores',
        ),
    },
    server: {
      // Dedicated vector database name — the knowledge base lives here. The
      // connection host/port/creds are owned by `@acme/db/env`; this stays here
      // as a rag-specific value (its only consumer). See docs/adr/0016.
      DB_VECTOR_NAME: z.string().nonempty(),
      CHUNK_SIZE: z.coerce.number().default(1024),
      CHUNK_OVERLAP: z.coerce.number().default(20),
    },
    client: {},
    runtimeEnv: {
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      NODE_ENV: process.env.NODE_ENV,
      // Use the dedicated vector database name; do NOT alias to DB_NAME
      DB_VECTOR_NAME: process.env.DB_VECTOR_NAME,
      CHUNK_OVERLAP: process.env.CHUNK_OVERLAP,
      CHUNK_SIZE: process.env.CHUNK_SIZE,
    },
    skipValidation,
  });
}

export const env = ragEnv();
