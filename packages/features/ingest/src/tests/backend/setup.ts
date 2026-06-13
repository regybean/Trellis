/* eslint-disable no-restricted-properties */
/**
 * Backend Test Setup
 *
 * Runs before each backend test file. Ingest has no DB/Redis of its own, so this
 * only:
 * - mocks env.ts so createEnv validation never runs
 * - mocks server-only so server modules import under vitest
 * - mocks the document store (@acme/llamaindex/server) and S3 client — the two
 *   external services the documents router talks to
 *
 * Tests set per-case return values via vi.mocked(...) on these mocks.
 */

import { beforeEach, vi } from 'vitest';

vi.mock('../../env', () => ({
  env: {
    NODE_ENV: 'test',
    NEXT_PUBLIC_WEBAPP: 'http://localhost:3000',
    AWS_REGION: 'eu-west-2',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    S3_UPLOAD_BUCKET: 'test-bucket',
  },
}));

// @acme/trpc constructs a Redis client at import time; mock its env so the
// import resolves. The documents router never consumes rateLimit, so Redis is
// never actually contacted.
vi.mock('@acme/redis/env', () => ({
  env: { REDIS_URL: 'redis://localhost:6379' },
}));

// @acme/trpc imports @acme/subscriptions, whose env.ts runs createEnv at import
// (it ignores SKIP_ENV_VALIDATION) and demands Stripe plan ids. The documents
// router calls none of these, so stub the module to bypass that validation.
vi.mock('@acme/subscriptions', () => ({
  getCredits: vi.fn(),
  getSubscriptionType: vi.fn(),
  getUserSubscriptionFromRedis: vi.fn(),
}));

// Allow importing server-only modules under vitest.
vi.mock('server-only', () => ({}));

// The document store — never index real documents in unit tests.
vi.mock('@acme/llamaindex/server', () => ({
  documentUploader: {
    listDocuments: vi.fn(),
    uploadDocs: vi.fn(),
    deleteByFilename: vi.fn(),
  },
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
