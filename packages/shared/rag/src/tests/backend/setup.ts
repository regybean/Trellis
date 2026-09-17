/**
 * Backend test setup for @acme/rag.
 *
 * Runs before each backend test file (after `@acme/test-utils/hydrate-env`,
 * which has populated `process.env` with the testcontainer DB details). `./env`
 * validates against the real running DB — no env mock. The document uploader
 * talks to a real vector database so cross-upload deduplication (a `vector_id`
 * overwrite that only happens inside Postgres) is exercised for real. Only the
 * embed model is faked: dedup keys on the content-derived id, never on the
 * embedding, so a fixed dummy vector is enough.
 *
 * - mock `@acme/models` with a functional embed model (real `embedMany` runs) —
 *   behavioral, not env-shaped, so it stays.
 */

import { vi } from 'vitest';

import { fakeModelsModule } from '../../testing';

// Real `embedMany` runs against the shared fake, which returns a fixed,
// dimension-correct vector per value so PgVector upserts succeed. The fake lives
// in `../../testing` (the `@acme/rag/testing` subpath) because chat's suite
// needs the identical one — see the note there on why the fixed vector is
// load-bearing rather than lazy.
vi.mock('@acme/models', () => fakeModelsModule());
