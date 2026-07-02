/**
 * Backend Test Setup
 *
 * Runs before each backend test file. Ingest has no DB/Redis of its own and env
 * is real (validated by env.ts against staticTestEnv), so this only mocks the
 * behavioral boundaries:
 * - server-only so server modules import under vitest
 * - the document store (@acme/rag/server) and S3 client — the two external
 *   services the documents router talks to
 *
 * Tests set per-case return values via vi.mocked(...) on these mocks.
 */

import { beforeEach, vi } from 'vitest';

// Allow importing server-only modules under vitest.
vi.mock('server-only', () => ({}));

// The document store — never index real documents in unit tests.
vi.mock('@acme/rag/server', () => ({
  listDocuments: vi.fn(),
  uploadDocs: vi.fn(),
  deleteByFilename: vi.fn(),
}));

// S3 — no network in unit tests.
vi.mock('../../utils/s3-client', () => ({
  generatePresignedUploadUrl: vi.fn(),
  downloadFileFromS3: vi.fn(),
  deleteFilesFromS3: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
