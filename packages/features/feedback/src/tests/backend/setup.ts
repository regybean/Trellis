/* eslint-disable no-restricted-properties */
/**
 * Backend Test Setup
 *
 * Runs before each test file. Mocks env + external services so the feedback
 * router can run against the testcontainer DB/Redis, and provisions the
 * app-owned `message_feedback` table (drizzle-kit owns its DDL in production;
 * tests create it directly). Mastra's `mastra_*` tables are created lazily by
 * the memory fixtures.
 */
import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, inject, vi } from 'vitest';

import { cleanupTestData } from './utils/test-context';

// Dedicated Postgres schema so a parallel suite's cleanup (unscoped DELETE on
// the Mastra `mastra_*` tables) can't wipe this suite's threads mid-test. turbo
// runs feature backend suites concurrently against one shared database; without
// per-package schemas they all share `nextjs.mastra_threads`. This is the
// Postgres analogue of the per-package Redis logical DB pinned below.
const { TEST_SCHEMA } = vi.hoisted(() => ({ TEST_SCHEMA: 'feedback_test' }));

vi.mock('../../env', () => {
  const REDIS_URL = inject('REDIS_URL');
  const DB_HOST = inject('DB_HOST');
  const DB_PORT = inject('DB_PORT');
  const DB_USER = inject('DB_USER');
  const DB_PASSWORD = inject('DB_PASSWORD');
  const DB_NAME = inject('DB_NAME');

  return {
    env: {
      NODE_ENV: 'test',
      NEXT_PUBLIC_WEBAPP: TEST_SCHEMA,
      DB_HOST,
      DB_PORT,
      DB_USER,
      DB_PASSWORD,
      DB_NAME,
      REDIS_URL,
    },
  };
});

// Point @acme/rag at the test database (it resolves the same `./env` file).
vi.mock('@acme/rag/env', () => ({
  env: {
    NODE_ENV: 'test',
    NEXT_PUBLIC_WEBAPP: TEST_SCHEMA,
    DB_HOST: inject('DB_HOST'),
    DB_PORT: Number(inject('DB_PORT')),
    DB_USER: inject('DB_USER'),
    DB_PASSWORD: inject('DB_PASSWORD'),
    DB_NAME: inject('DB_NAME'),
    DB_VECTOR_NAME: 'vectordb',
    CHUNK_SIZE: 768,
    CHUNK_OVERLAP: 20,
    AWS_REGION: 'eu-west-2',
    BEDROCK_CHAT_MODEL: 'test-model',
  },
}));

vi.mock('@acme/redis/env', () => {
  // Dedicated Redis logical DB so a parallel suite's flushDb() can't wipe ours.
  const injected = inject('REDIS_URL');
  if (!injected) throw new Error('REDIS_URL not provided to test workers');
  const REDIS_URL = `${injected.replace(/\/+$/, '')}/3`;
  return { env: { REDIS_URL } };
});

// isTierAtLeast delegates to the real implementation from @acme/entitlements
// so requireTier gates behave correctly under test.
vi.mock('@acme/subscriptions', async () => {
  const { isTierAtLeast } = await import('@acme/entitlements');
  return {
    credits: {
      read: vi.fn().mockResolvedValue({
        remaining: 100,
        limit: 250,
        resetAt: Math.floor(Date.now() / 1000) + 86_400 * 30,
      }),
      consume: vi.fn().mockResolvedValue(undefined),
    },
    getUserSubscriptionFromRedis: vi.fn().mockResolvedValue({ status: 'none' }),
    getSubscriptionType: vi.fn().mockReturnValue('Basic'),
    isTierAtLeast: vi.fn().mockImplementation(isTierAtLeast),
  };
});

// Allow importing server components in vitest.
vi.mock('server-only', () => ({}));

// @acme/rag's documents-schema reads EMBED_DIMENSIONS from @acme/models/env at
// load time; provide a fixed value so the schema builds without a real provider.
vi.mock('@acme/models/env', () => ({
  modelsEnv: vi.fn().mockReturnValue({
    LLM_PROVIDER: 'ollama',
    EMBED_PROVIDER: 'ollama',
    EMBED_DIMENSIONS: 768,
  }),
}));

// Create the app-owned table the way drizzle-kit would in production. Idempotent
// so it can run once per test file. Imported after the env mocks so `db`
// connects to the testcontainer.
beforeAll(async () => {
  const { db } = await import('../../api/trpc');
  const schema = TEST_SCHEMA;
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`));
  await db.execute(
    sql.raw(
      `DO $$ BEGIN CREATE TYPE "${schema}"."feedback_rating" AS ENUM ('up', 'down'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS "${schema}"."message_feedback" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "message_id" text NOT NULL,
        "thread_id" text NOT NULL,
        "user_id" text NOT NULL,
        "rating" "${schema}"."feedback_rating" NOT NULL,
        "comment" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "message_feedback_message_user_unique" UNIQUE ("message_id", "user_id")
      )`,
    ),
  );
});

afterEach(async () => {
  try {
    await cleanupTestData();
  } catch {
    // Ignore cleanup errors (DB might not be connected in some scenarios).
  }
});
