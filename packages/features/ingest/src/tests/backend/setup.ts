/**
 * Backend Test Setup
 *
 * Runs before each backend test file (after `@acme/test-utils/hydrate-env`, which
 * has populated `process.env` with the testcontainer DB/Redis details). Env is
 * real — validated by env.ts against the running services (no env mocks). Only
 * behavioral boundaries are mocked:
 * - `server-only` so server modules import under vitest
 * - the S3 client (`utils/s3-client`) — no network in tests
 * - `@acme/models`, with a functional fake embed model so real `embedMany` runs
 *   against a fixed dimension-correct vector (mirrors @acme/rag's suite)
 *
 * `@acme/rag/server` is NOT mocked here: the progress reader tails a real Redis
 * Stream, and the worker path (ticket 3) indexes for real. A pure orchestration
 * test that only needs the document store stubbed mocks it locally instead.
 */

import { MockEmbeddingModelV3 } from 'ai/test';
import { beforeEach, vi } from 'vitest';

// Allow importing server-only modules under vitest.
vi.mock('server-only', () => ({}));

// S3 — no network in tests.
vi.mock('../../utils/s3-client', () => ({
  generatePresignedUploadUrl: vi.fn(),
  downloadFileFromS3: vi.fn(),
  deleteFilesFromS3: vi.fn(),
}));

// Fixed vector dimension for tests — matches EMBED_DIMENSIONS (staticTestEnv), the
// dimension the knowledge-base vector column / PgVector index is sized with. Real
// `embedMany` runs against this fake model; its content is irrelevant to indexing
// (dedup keys on the content-derived id, never on the embedding).
const EMBED_DIMENSIONS = 768;

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

beforeEach(() => {
  vi.clearAllMocks();
});
