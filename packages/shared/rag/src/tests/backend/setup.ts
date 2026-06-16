/* eslint-disable no-restricted-properties */
/**
 * Backend test setup for @acme/rag.
 *
 * Runs before each backend test file. The document uploader talks to a real
 * vector database (testcontainers / local docker-compose) so that cross-upload
 * deduplication — a `vector_id` overwrite that only happens inside Postgres — is
 * exercised for real. Only the embed model is faked: dedup keys on the
 * content-derived id, never on the embedding, so a fixed dummy vector is enough.
 *
 * - mock `./env` so @acme/rag connects to the test DB without env validation
 * - mock `@acme/models` with a functional embed model (real `embedMany` runs)
 * - mock `@acme/models/env` so the schema's vector dimension is fixed
 */

import { MockEmbeddingModelV3 } from 'ai/test';
import { inject, vi } from 'vitest';

// Fixed vector dimension for tests — must match the EMBED_DIMENSIONS the schema
// and PgVector index are built with (mocked below).
const EMBED_DIMENSIONS = 1024;

// Point @acme/rag at the test databases. Mocking the env module (the same file
// rag's internal `./env` imports resolve to) lets the uploader and vector store
// connect to the testcontainer without running real env validation.
vi.mock('../../env', () => ({
  env: {
    NODE_ENV: 'test',
    NEXT_PUBLIC_WEBAPP: inject('NEXT_PUBLIC_WEBAPP'),
    DB_HOST: inject('DB_HOST'),
    DB_PORT: Number(inject('DB_PORT')),
    DB_USER: inject('DB_USER'),
    DB_PASSWORD: inject('DB_PASSWORD'),
    DB_NAME: inject('DB_NAME'),
    // The shared test harness provisions a `vectordb` database alongside the app
    // DB but does not inject its name; pin it here.
    DB_VECTOR_NAME: 'vectordb',
    CHUNK_SIZE: 1024,
    CHUNK_OVERLAP: 20,
  },
}));

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

// documents-schema reads EMBED_DIMENSIONS from this subpath at load time to size
// the vector column / index. Provide a fixed value so the schema builds without
// a real provider configured.
vi.mock('@acme/models/env', () => ({
  modelsEnv: vi.fn().mockReturnValue({
    LLM_PROVIDER: 'ollama',
    EMBED_PROVIDER: 'ollama',
    EMBED_DIMENSIONS,
  }),
}));
