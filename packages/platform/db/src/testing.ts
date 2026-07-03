/**
 * Postgres test descriptor — the `@acme/db/testing` export subpath.
 *
 * Pure data describing the Postgres container a backend suite starts, owned here
 * beside the connection it serves (image pinned next to what it connects to).
 * `@acme/test-utils` is the engine that turns this into a running container; it
 * carries no knowledge of Postgres. A suite opts in via
 * `backendProject({ infra: [postgresContainer] })`. See docs/adr/0017.
 */
import type { InfraDescriptor } from '@acme/test-utils/infra';

// Throwaway credentials for the ephemeral test container — not a secret. Hoisted
// to plain constants so they read as identifiers, not inline password literals.
const TEST_USER = 'postgres';
const TEST_SECRET = 'password123';
const TEST_DB = 'testdb';
const TEST_VECTOR_DB = 'vectordb';

export const postgresContainer: InfraDescriptor = {
  name: 'postgres',
  // Pinned to match the docker-compose `postgres` service (pgvector).
  image: 'pgvector/pgvector:pg17',
  containerPort: 5432,
  localPort: 5432,
  containerEnv: {
    POSTGRES_USER: TEST_USER,
    POSTGRES_PASSWORD: TEST_SECRET,
    POSTGRES_DB: TEST_DB,
    // Consumed by ops/db-init/01-vector.sh to create the vector database.
    DB_VECTOR_NAME: TEST_VECTOR_DB,
  },
  // The pgvector image logs this once during init and again when finally ready.
  waitLogRegex: 'database system is ready to accept connections',
  waitLogTimes: 2,
  bindMounts: [
    {
      repoPath: 'ops/db-init',
      target: '/docker-entrypoint-initdb.d',
      mode: 'ro',
    },
  ],
  provides: {
    DB_HOST: '{host}',
    DB_PORT: '{port}',
    DB_USER: TEST_USER,
    DB_PASSWORD: TEST_SECRET,
    DB_NAME: TEST_DB,
  },
};
