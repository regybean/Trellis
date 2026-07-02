/**
 * Backend Test Setup
 *
 * Runs before each test file (after `@acme/test-utils/hydrate-env`, which has
 * already populated `process.env` with the testcontainer DB/Redis details).
 * Every `env.ts` therefore validates against the real running services — no env
 * mocks. Only behavioral/external-service mocks live here. `beforeAll` provisions
 * the app-owned `message_feedback` table by deriving its DDL from the SAME
 * Drizzle schema production uses, so test DDL can never drift from the schema.
 * Mastra's `mastra_*` tables are created lazily by the memory fixtures.
 */
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { sql } from 'drizzle-orm';
import { afterEach, beforeAll, vi } from 'vitest';

import { cleanupTestData } from './utils/test-context';

// drizzle wraps the driver error, so the "already exists" text is on the cause
// chain, not the top-level message. Walk it. Covers duplicate schema/type/table.
function isAlreadyExists(error: unknown) {
  let current: unknown = error;
  while (current instanceof Error) {
    if (/already exists/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

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

// Provision the app-owned table the way drizzle-kit would in production, but
// driven by the Drizzle schema itself rather than hand-written SQL: a diff from
// an empty database to the code schema. It runs in-worker, where
// NEXT_PUBLIC_WEBAPP names this suite's isolated Postgres schema — the same value
// `feedback-schema.ts` reads to place the table — and `db` connects to the
// testcontainer. Because the diff is empty -> schema, it only ever emits CREATE
// statements and never inspects (or drops) Mastra's runtime `mastra_*` tables.
beforeAll(async () => {
  const { db } = await import('../../api/trpc');
  const schema = await import('../../api/schemas/feedback-schema');

  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  );

  for (const statement of statements) {
    try {
      await db.execute(sql.raw(statement));
    } catch (error) {
      // Idempotent across runs: the shared local DB persists, so the schema /
      // enum / table may already exist — only "already exists" is tolerated.
      if (!isAlreadyExists(error)) throw error;
    }
  }
});

afterEach(async () => {
  try {
    await cleanupTestData();
  } catch {
    // Ignore cleanup errors (DB might not be connected in some scenarios).
  }
});
