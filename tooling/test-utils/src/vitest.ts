/**
 * Shared Vitest test env + backend project preset.
 *
 * `staticTestEnv` is the one place static, non-secret env lives so every
 * package's `env.ts` (`createEnv`) validates against real values instead of
 * being hand-mocked in each `setup.ts`. It is spread into both backend and
 * frontend configs. Dynamic, per-run DB/Redis connection details are hydrated
 * separately from testcontainers by `@acme/test-utils/hydrate-env`.
 *
 * `backendProject` folds the identical backend wiring (env spread, hydrate-env
 * setupFile ordering, testcontainer globalSetup, single non-isolated forked
 * worker, generous timeouts) into one call so a feature's
 * `vitest.config.backend.ts` only declares what's unique to it.
 */
import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from '@acme/vitest-config/base';

/**
 * Static, non-secret env shared by every suite. Values only need to satisfy
 * each `env.ts` schema — they are never used to reach a real service.
 *
 * `NEXT_PUBLIC_WEBAPP` is a neutral default (a valid Postgres identifier);
 * backend suites override it per-package for schema isolation.
 *
 * Provider selection + model ids: ai-sdk factories only build config objects at
 * import (no network), so `@acme/models` resolve.ts constructs fine with these
 * — no `@acme/models` mock needed.
 */
export const staticTestEnv = {
  NEXT_PUBLIC_WEBAPP: 'testing',
  // @acme/models
  LLM_PROVIDER: 'ollama',
  EMBED_PROVIDER: 'ollama',
  EMBED_DIMENSIONS: '768',
  OLLAMA_BASE_URL: 'http://localhost:11434/v1',
  OLLAMA_CHAT_MODEL: 'test-chat',
  OLLAMA_EMBED_MODEL: 'test-embed',
  // @acme/rag (CHUNK_SIZE/OVERLAP have defaults)
  DB_VECTOR_NAME: 'vectordb',
  // @acme/ingest — AWS/S3. Never contacted (S3 client + doc store are mocked).
  AWS_REGION: 'eu-west-2',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  S3_UPLOAD_BUCKET: 'test-bucket',
  // Fallback for infra-less suites (e.g. ingest, whose @acme/redis/env only
  // needs a valid url — Redis is never contacted). Backend suites with a
  // testcontainer have this overwritten per-run by hydrate-env.
  REDIS_URL: 'redis://localhost:6379',
  // @acme/billing — client vars are validated even in jsdom (client mode)
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
  NEXT_PUBLIC_STRIPE_MANAGE_BILLING_URL: 'https://billing.example.test/manage',
  NEXT_PUBLIC_STRIPE_PRO_PLAN_ID: 'price_pro_test',
  NEXT_PUBLIC_STRIPE_STANDARD_PLAN_ID: 'price_standard_test',
  // @acme/billing — server vars
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
  STRIPE_SUCCESS_URL: 'https://app.example.test/success',
  STRIPE_CANCEL_URL: 'https://app.example.test/cancel',
} satisfies Record<string, string>;

interface BackendProjectOptions {
  /**
   * Dedicated Postgres schema for this suite (parallel cleanup isolation).
   * turbo runs feature backend suites concurrently against one shared database.
   * Also drives the per-app Redis key namespace.
   */
  webapp: string;
  /**
   * Dedicated Redis logical DB for this suite (parallel flushDb isolation).
   * Appended to the injected REDIS_URL by hydrate-env when set.
   */
  redisDb?: string;
  /** The package's own setup file(s), run after hydrate-env. */
  setupFiles?: string[];
  include?: string[];
  /**
   * The testcontainer global-setup. Defaults to the shared
   * `@acme/test-utils/setup` — a package only needs to override this when it has
   * extra provisioning to do (e.g. a drizzle-kit push of its own schema).
   */
  globalSetup?: string;
  /**
   * Whether this suite needs the DB/Redis testcontainers. Default `true`. Set
   * `false` for a suite that touches no infra (its externals are all mocked):
   * no containers are started and env is not hydrated — the tests run anywhere.
   */
  infra?: boolean;
}

export function backendProject({
  webapp,
  redisDb,
  setupFiles = [],
  include = ['src/tests/backend/**/*.test.ts'],
  globalSetup = '@acme/test-utils/setup',
  infra = true,
}: BackendProjectOptions) {
  return mergeConfig(
    baseConfig,
    defineConfig({
      test: {
        name: 'backend',
        environment: 'node',
        env: {
          ...staticTestEnv,
          NEXT_PUBLIC_WEBAPP: webapp,
          ...(redisDb ? { TEST_REDIS_DB: redisDb } : {}),
        },
        include,
        // With infra, hydrate-env runs first: copies testcontainer connection
        // details into process.env so every env.ts validates against the real
        // DB/Redis. Infra-less suites skip it (their externals are mocked).
        setupFiles: infra
          ? ['@acme/test-utils/hydrate-env', ...setupFiles]
          : setupFiles,
        // Starts/stops the PostgreSQL + Redis testcontainers (needs Docker).
        ...(infra ? { globalSetup: [globalSetup] } : {}),
        // Real DB means generous timeouts and a single, non-isolated worker so
        // tests share one connection/transaction space deterministically.
        testTimeout: 60_000,
        hookTimeout: 60_000,
        pool: 'forks',
        maxWorkers: 1,
        isolate: false,
      },
    }),
  );
}
