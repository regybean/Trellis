/**
 * Backend test setup.
 *
 * Runs after `@acme/test-utils/hydrate-env` (which populates `process.env` with
 * the testcontainer Redis details), so `env.ts` validates against the real
 * running Redis — no env mocks (ADR 0014). The only behavioural mock is
 * `server-only`, which lets `publish` (guarded by `import 'server-only'`) be
 * imported under vitest. Nothing else is mocked — the whole point is the real
 * round-trip through Redis.
 */
import { afterEach, beforeEach, vi } from 'vitest';

import { flushTestDb } from '@acme/redis/testing';

vi.mock('server-only', () => ({}));

// Isolate every test on this suite's dedicated logical Redis DB.
beforeEach(async () => {
  await flushTestDb();
});

afterEach(async () => {
  await flushTestDb();
});
