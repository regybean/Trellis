/**
 * Postgres test descriptor — the `@acme/db/testing` export subpath.
 *
 * Pure data describing the Postgres container a backend suite starts, owned here
 * beside the connection it serves (image pinned next to what it connects to).
 * `@acme/test-utils` is the engine that turns this into a running container; it
 * carries no knowledge of Postgres. A suite opts in from its per-suite
 * global-setup file via `runInfraSetup([postgresContainer])`. See docs/adr/0017.
 */
import type { InfraDescriptor } from '@acme/test-utils/infra';

import { DB_DEVELOPMENT_PROFILE } from './development-profile';

// The throwaway credentials for the ephemeral test container come from the same
// authored development profile the app connects with, so a suite validates
// against the values it provisions (@acme/env ADR 0001 §6). `DB_VECTOR_NAME` is
// `@acme/rag`'s to author, so it stays a literal here rather than making this
// package depend on that one; the two agree by convention and the init script
// defaults to the same name.
const { DB_USER: TEST_USER, DB_NAME: TEST_DB } = DB_DEVELOPMENT_PROFILE;
// The container's throwaway password — a secret on every target (no profile
// authors it), so it stays a literal here, matching `deploy/.env.example`.
const TEST_SECRET = 'password123';
const TEST_VECTOR_DB = 'vectordb';

export const postgresContainer: InfraDescriptor = {
  name: 'postgres',
  // Pinned to match the docker-compose `postgres` service (pgvector).
  image: 'pgvector/pgvector:pg17',
  // Container-internal only. Testcontainers publishes it to a random host port,
  // so a suite never contends with the dev stack's fixed port (see `development-profile.ts`).
  containerPort: 5432,
  containerEnv: {
    POSTGRES_USER: TEST_USER,
    POSTGRES_PASSWORD: TEST_SECRET,
    POSTGRES_DB: TEST_DB,
    // Consumed by deploy/ops/db-init/01-vector.sh to create the vector database.
    DB_VECTOR_NAME: TEST_VECTOR_DB,
  },
  // The pgvector image logs this once during init and again when finally ready.
  waitLogRegex: 'database system is ready to accept connections',
  waitLogTimes: 2,
  bindMounts: [
    {
      repoPath: 'deploy/ops/db-init',
      target: '/docker-entrypoint-initdb.d',
      mode: 'ro',
    },
  ],
  provides: (host, port) => ({
    DB_HOST: host,
    DB_PORT: String(port),
    DB_USER: TEST_USER,
    DB_PASSWORD: TEST_SECRET,
    DB_NAME: TEST_DB,
  }),
};
