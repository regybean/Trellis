/**
 * Backend Test Setup
 *
 * Runs before each test file (after `@acme/test-utils/hydrate-env`, which has
 * already populated `process.env` with the testcontainer DB/Redis details).
 * Every `env.ts` therefore validates against the real running services — no env
 * mocks. Only behavioral/external-service mocks live here. App-owned tables
 * (incl. `message_feedback`) are provisioned once by the global `drizzle-kit
 * push --force` into this suite's isolated schema (ADR 0021) — not here.
 * Mastra's `mastra_*` tables are created lazily by the memory fixtures.
 */
import { afterEach, vi } from 'vitest';

import { cleanupTestData } from './utils/test-context';

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
      consume: vi.fn(() => Promise.resolve()),
    },
    getUserSubscriptionFromRedis: vi.fn().mockResolvedValue({ status: 'none' }),
    getSubscriptionType: vi.fn().mockReturnValue('Basic'),
    isTierAtLeast: vi.fn().mockImplementation(isTierAtLeast),
  };
});

// Allow importing server components in vitest.
vi.mock('server-only', () => ({}));

afterEach(async () => {
  try {
    await cleanupTestData();
  } catch {
    // Ignore cleanup errors (DB might not be connected in some scenarios).
  }
});
