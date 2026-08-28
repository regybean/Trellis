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
 *   against a fixed dimension-correct vector (mirrors @acme/rag's suite). Mocking
 *   it requires the package to be resolvable from here — see the note at the mock.
 *
 * `@acme/rag/server` is NOT mocked here: the progress reader tails a real Redis
 * Stream, and the worker path (ticket 3) indexes for real. A pure orchestration
 * test that only needs the document store stubbed mocks it locally instead.
 */

import { MockEmbeddingModelV3 } from 'ai/test';
import { beforeEach, vi } from 'vitest';

import {
  deleteFilesFromS3,
  downloadFileFromS3,
  generatePresignedUploadUrl,
} from '../../utils/s3-client';

// Allow importing server-only modules under vitest.
vi.mock('server-only', () => ({}));

// S3 — no network in tests. Resolved to the manual mock in
// `src/utils/__mocks__/s3-client.ts`: a single module the registry evaluates once,
// so the REAL processor/router and the test files share ONE set of mock fns. An
// inline factory here (a per-file setupFile) would hand divergent instances to
// files in the non-isolated suite. Defaults are applied per-test below.
vi.mock('../../utils/s3-client');

// Fixed vector dimension for tests — matches EMBED_DIMENSIONS (staticTestEnv), the
// dimension the knowledge-base vector column / PgVector index is sized with. Real
// `embedMany` runs against this fake model; its content is irrelevant to indexing
// (dedup keys on the content-derived id, never on the embedding).
const EMBED_DIMENSIONS = 768;

// `vi.mock` keys the registry on the RESOLVED module id, resolved from the file
// that calls it — this setup file, inside @acme/ingest. Under pnpm's strict
// node_modules a package can only resolve what it declares, and ingest declared no
// `@acme/models`: there was no `node_modules/@acme/models` symlink here to resolve
// through. Vitest does not fail on an unresolvable mock path — it registers the
// literal string instead, which never matches the id @acme/rag's
// `document-uploader.ts` resolves the same specifier to
// (`packages/shared/models/src/index.ts`). The mock silently no-op'd and `uploadDoc`
// embedded against a real Ollama on localhost:11434 (issue #232), which the dev
// compose stack happened to be serving — so the suite passed for the wrong reason.
// The fix is the `@acme/models` devDependency in package.json: with the symlink
// present both packages resolve to the same realpath, one module id, one mock.
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
  // Always-on S3 defaults (mirrors chat's always-stubbed `chatAgent.stream`).
  // The suite is non-isolated with a persistent BullMQ worker (worker-e2e), so a
  // job can be drained between tests when no per-test impl is set — an unset mock
  // would crash the processor on `undefined`. Tests override these per case.
  vi.mocked(generatePresignedUploadUrl).mockResolvedValue(
    'https://s3.test/upload',
  );
  vi.mocked(downloadFileFromS3).mockResolvedValue({
    buffer: Buffer.from('Default test content worth chunking and embedding.'),
    contentType: 'text/plain',
  });
  vi.mocked(deleteFilesFromS3).mockImplementation(() => Promise.resolve());
});
