import { vi } from 'vitest';

// Manual mock for the S3 client (auto-selected by `vi.mock('../../utils/s3-client')`
// in the backend setup). It lives in a single module the registry evaluates ONCE,
// so every importer — the test files AND the real processor/router they drive —
// shares the SAME mock fns. An inline `vi.mock` factory in the (per-file) setup
// would instead hand divergent instances to files in the non-isolated suite, and
// a per-test stub would never reach the code under test. Defaults are (re)applied
// in setup.ts's `beforeEach`; tests override per case.
export const s3Client = {};
export const generatePresignedUploadUrl = vi.fn();
export const downloadFileFromS3 = vi.fn();
export const deleteFilesFromS3 = vi.fn();
