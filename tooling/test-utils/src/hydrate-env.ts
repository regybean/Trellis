/**
 * Env Hydration (backend setupFile)
 *
 * Copies the testcontainer connection details published by `global-setup`
 * (`project.provide(...)`) into `process.env` **before any test module — and
 * therefore any `env.ts` — is imported**. This is what lets each package's
 * `createEnv()` validate against the real, running DB/Redis instead of being
 * hand-mocked in every `setup.ts`.
 *
 * Static, non-secret defaults (provider selection, model ids, vector db name,
 * embedding dimensions) are set once in the shared vitest base config's
 * `test.env`; only the dynamic, per-run values (host/port, mapped Redis url)
 * come from `inject(...)` here.
 *
 * Per-package knobs read from `process.env` (set via each package's
 * `vitest.config.backend.ts` → `test.env`):
 * - `NEXT_PUBLIC_WEBAPP` — dedicated Postgres schema per suite (parallel
 *   cleanup isolation). Left untouched here.
 * - `TEST_REDIS_DB` — dedicated Redis logical DB per suite (parallel flushDb
 *   isolation). Appended to the injected `REDIS_URL` when present.
 *
 * Usage: list before the package's own setup file in `setupFiles`:
 *   setupFiles: ['@acme/test-utils/hydrate-env', './src/tests/backend/setup.ts']
 */

import { inject } from 'vitest';

function set(key: string, value: string | undefined) {
  if (value !== undefined && value !== '') {
    process.env[key] = value;
  }
}

// Redis: append the per-suite logical DB when one is configured, so a parallel
// suite's flushDb() can't wipe ours. `redis://host:port/2` is a valid url.
const redisBase = inject('REDIS_URL');
// eslint-disable-next-line turbo/no-undeclared-env-vars
const redisDb = process.env.TEST_REDIS_DB;
set(
  'REDIS_URL',
  redisBase && redisDb
    ? `${redisBase.replace(/\/+$/, '')}/${redisDb}`
    : redisBase,
);

set('DB_HOST', inject('DB_HOST'));
set('DB_PORT', inject('DB_PORT'));
set('DB_USER', inject('DB_USER'));
set('DB_PASSWORD', inject('DB_PASSWORD'));
set('DB_NAME', inject('DB_NAME'));
