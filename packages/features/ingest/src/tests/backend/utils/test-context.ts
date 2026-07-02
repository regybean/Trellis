/**
 * Test Context — ingest.
 *
 * The tRPC caller context comes from the one canonical builder
 * (`@acme/trpc/testing`). Ingest touches neither the feature DB nor Redis (its
 * external deps — the document store and S3 — are mocked in `setup.ts`), so
 * there is no data cleanup to own here.
 */

export { createTestContext } from '@acme/trpc/testing';
export type { TestContextOptions } from '@acme/trpc/testing';
