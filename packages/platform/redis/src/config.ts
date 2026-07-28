import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Redis connection config-as-code (ADR 0026, #124). `REDIS_URL` is a non-secret
 * connection string authored here per deploy target, so it no longer has to live
 * in `.env`. `env.ts` layers a runtime `process.env.REDIS_URL` override on top for
 * the *dynamic* case only — a testcontainer hands back a mapped port, and a prod
 * endpoint is infra-injected — which static config cannot know. Mirrors `dbConfig`
 * (host/port); this is `@acme/redis`'s config home for the whole DSN. Server-side —
 * the client factory runs on the backend.
 *
 * The base (development) value doubles as the test-container value
 * (`redis://localhost:6379`), so a suite validates against the same endpoint it
 * connects to.
 */
export function redisConfig(context: ConfigContext) {
  return createConfig({
    server: {
      REDIS_URL: z.url(),
    },
    profiles: {
      default: {
        server: {
          REDIS_URL: 'redis://localhost:6379',
        },
      },
    },
    context,
  });
}
