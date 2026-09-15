/**
 * Env Hydration (backend setupFile)
 *
 * Copies the connection details `global-setup` published (`project.provide`) as
 * a single `infraEnv` record into `process.env` **before any test module — and
 * therefore any `env.ts` — is imported**. This is what lets each package's
 * `createEnv()` validate against the real, running DB/Redis instead of being
 * hand-mocked in every `setup.ts`.
 *
 * Static, non-secret defaults (provider selection, model ids, vector db name,
 * embedding dimensions) are set once in the shared vitest base config's
 * `test.env`; only the dynamic, per-run values (host/port, mapped Redis url)
 * come from `inject('infraEnv')` here.
 *
 * Per-package knobs read from `process.env` (set via each package's
 * `vitest.config.backend.ts` → `test.env`):
 * - `NEXT_PUBLIC_WEBAPP` — dedicated Postgres schema per suite. Left untouched.
 * - `TEST_REDIS_DB` — dedicated Redis logical DB per suite (parallel flushDb
 *   isolation). Appended to the injected `REDIS_URL` when present.
 *
 * This module is the import-time half only: it gathers the two inputs and
 * assigns what `hydrateEnv` resolves. The rule itself lives in
 * `./env-hydration`, where a test can call it. Nothing here is exported, so a
 * suite's `setupFiles` entry is unchanged.
 *
 * Usage: list before the package's own setup file in `setupFiles`:
 *   setupFiles: ['@acme/test-utils/hydrate-env', './src/tests/backend/setup.ts']
 */

import { inject } from 'vitest';

import { hydrateEnv } from './env-hydration';

const resolved = hydrateEnv({
  infraEnv: inject('infraEnv'),
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  redisDb: process.env.TEST_REDIS_DB,
});

for (const [key, value] of Object.entries(resolved)) {
  process.env[key] = value;
}
