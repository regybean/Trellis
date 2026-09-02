/**
 * Backend test setup.
 *
 * Runs after `@acme/test-utils/hydrate-env`, which has already put the Postgres
 * container's `DB_*` into `process.env` — so `@acme/db/env` and `@acme/auth/env`
 * validate against the real running service rather than a mock (ADR 0014). The
 * four Better Auth tables are provisioned once by the global `drizzle-kit push
 * --force` (ADR 0021), which creates them in the `auth` schema because the
 * canonical app re-exports them.
 *
 * No behavioural mocks: this suite has no external service to stub. The one
 * `vi.mock` below is not a seam — it neutralises Next.js's build-time
 * `server-only` guard so `@acme/trpc` imports under vitest, exactly as the
 * billing, chat and ingest backend suites already do. What it guards is the
 * bundler, and there is no bundler here.
 */
import { afterEach, vi } from 'vitest';

import { cleanupTestData } from './utils/fixtures';

vi.mock('server-only', () => ({}));

afterEach(async () => {
  await cleanupTestData();
});
