// Starts/stops PostgreSQL + Redis testcontainers once per test run and publishes
// their connection details (DB_HOST, REDIS_URL, ...) for `inject(...)` in setup.ts.
// Requires Docker to be running.
export { setup, teardown } from '@acme/test-utils/setup';
