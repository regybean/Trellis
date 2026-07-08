import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod/v4';

import { shouldSkipEnvValidation } from '@acme/env';

const skipValidation = shouldSkipEnvValidation();

// The Postgres connection env — the single home for the DB_* connection values,
// mirroring how `@acme/redis/env` owns REDIS_URL. Owns *how you connect*, not
// *what any feature stores* (features keep their own table schemas) nor the
// dedicated vector database name (`DB_VECTOR_NAME` stays in `@acme/rag/env`,
// its only consumer). See docs/adr/0016.
function dbEnv() {
  return createEnv({
    shared: {
      NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    },
    server: {
      DB_HOST: z.string().nonempty(),
      DB_PORT: z.coerce.number(),
      DB_USER: z.string().nonempty(),
      DB_PASSWORD: z.string().nonempty(),
      // The application database (relational tables + Mastra Memory).
      DB_NAME: z.string().nonempty(),
    },
    client: {},
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      DB_USER: process.env.DB_USER,
      DB_PASSWORD: process.env.DB_PASSWORD,
      DB_NAME: process.env.DB_NAME,
    },
    skipValidation,
  });
}

export const env = dbEnv();
