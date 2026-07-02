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

import { MockEmbeddingModelV3 } from 'ai/test';
import { vi } from 'vitest';

// Fixed vector dimension for tests — matches EMBED_DIMENSIONS (staticTestEnv),
// the dimension documents-schema sizes the vector column / PgVector index with.
const EMBED_DIMENSIONS = 768;

// Real `embedMany` runs against this fake model: it returns a fixed,
// dimension-correct vector per value so PgVector upserts succeed. The vector
// content is irrelevant to dedup, which keys on the content-derived id.
vi.mock('@acme/models', () => ({
  chatModel: {},
  embedModel: new MockEmbeddingModelV3({
    doEmbed: ({ values }: { values: string[] }) =>
      Promise.resolve({
        embeddings: values.map(() =>
          Array.from({ length: EMBED_DIMENSIONS }, () => 0.1),
        ),
        warnings: [],
      }),
  }),
  embedProviderOptions: vi.fn().mockReturnValue({}),
}));
