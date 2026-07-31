/**
 * Documents Router Tests
 *
 * Testing philosophy:
 * - Test auth/middleware ONCE (every procedure uses adminProcedure).
 * - Presign: assert the server-minted Job identity and reshaped response.
 * - startIngestJob: validation (jobId-prefix guard), the real-queue enqueue
 *   read-back through `_ingestQueue`, and the TRPCError-on-enqueue-failure path.
 *
 * `@acme/rag/server` is driven FOR REAL (never `vi.mock`'d — the processor + worker
 * e2e in this same non-isolated suite import it real, and a local mock would
 * corrupt the shared module registry). Only S3 is mocked (setup.ts). The queue is
 * REAL (BullMQ on the testcontainer Redis).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureVectorIndex } from '@acme/rag/server';

import type { TestContextOptions } from '../../utils/test-context';
import { appRouter } from '../../../../api/root';
import { _ingestQueue } from '../../../../api/services/ingest-queue';
import { generatePresignedUploadUrl } from '../../../../utils/s3-client';
import { createTestContext } from '../../utils/test-context';

const adminOpts: TestContextOptions = {
  userId: 'user_admin',
  role: 'admin',
  tier: 'Basic',
  credits: { remaining: 250, limit: 250, resetAt: Date.now() },
};

function createCaller(opts: TestContextOptions) {
  return appRouter.createCaller(createTestContext(opts));
}

// Presign a one-file batch and reshape the response into the `startIngestJob`
// input (echoed server-minted ids + s3Key).
async function presignedBatch() {
  vi.mocked(generatePresignedUploadUrl).mockImplementation((key) =>
    Promise.resolve(`https://s3.test/${key}`),
  );
  const { jobId, uploads } = await createCaller(
    adminOpts,
  ).documents.getPresignedUploadUrls({
    files: [{ filename: 'a.pdf', contentType: 'application/pdf' }],
  });
  return {
    jobId,
    uploads: uploads.map((u) => ({
      uploadId: u.uploadId,
      filename: u.filename,
      s3Key: u.s3Key,
    })),
  };
}

describe('documentsRouter', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // No worker runs here, so jobs pile up; clear between tests to avoid jobId
    // dedup collisions on the enqueue read-back.
    await _ingestQueue.obliterate({ force: true });
  });

  describe('middleware (tested once)', () => {
    it('rejects non-admin users', async () => {
      const caller = createCaller({ ...adminOpts, role: 'user' });

      await expect(caller.documents.list()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('getPresignedUploadUrls', () => {
    it('server-mints one Job id + per-file upload id, keys nested under both', async () => {
      vi.mocked(generatePresignedUploadUrl).mockImplementation((key) =>
        Promise.resolve(`https://s3.test/${key}`),
      );

      const result = await createCaller(
        adminOpts,
      ).documents.getPresignedUploadUrls({
        files: [
          { filename: 'a.pdf', contentType: 'application/pdf' },
          { filename: 'b.txt', contentType: 'text/plain' },
        ],
      });

      expect(result.jobId).toMatch(/\S/);
      expect(result.uploads).toHaveLength(2);
      expect(generatePresignedUploadUrl).toHaveBeenCalledTimes(2);

      // Every key nests jobId AND the per-file uploadId, so same-named files in
      // one Job never collide: uploads/${jobId}/${uploadId}/${filename}.
      for (const upload of result.uploads) {
        expect(upload.s3Key).toBe(
          `uploads/${result.jobId}/${upload.uploadId}/${upload.filename}`,
        );
        expect(upload.uploadUrl).toContain(upload.s3Key);
      }
      // Per-file uploadIds are distinct.
      const ids = result.uploads.map((u) => u.uploadId);
      expect(new Set(ids).size).toBe(2);
      expect(result.uploads.map((u) => u.filename)).toEqual(['a.pdf', 'b.txt']);
    });
  });

  describe('startIngestJob', () => {
    it('enqueues one job per batch (real queue read-back) and returns { jobId }', async () => {
      const { jobId, uploads } = await presignedBatch();

      const result = await createCaller(adminOpts).documents.startIngestJob({
        jobId,
        uploads,
      });
      expect(result).toEqual({ jobId });

      // Read the job back off the real queue: one job under the jobId dedup key,
      // carrying the userId + the echoed uploads.
      const job = await _ingestQueue.getJob(jobId);
      if (!job) throw new Error('expected the job to be enqueued');
      expect(job.data.userId).toBe(adminOpts.userId);
      expect(job.data.jobId).toBe(jobId);
      expect(job.data.uploads).toEqual(uploads);
    });

    it('rejects an s3Key that does not belong to the job (prefix guard)', async () => {
      const { jobId, uploads } = await presignedBatch();
      const [first] = uploads;
      if (!first) throw new Error('expected a presigned upload');

      await expect(
        createCaller(adminOpts).documents.startIngestJob({
          jobId,
          uploads: [{ ...first, s3Key: 'uploads/other-job/x/a.pdf' }],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      // Nothing enqueued on a rejected batch.
      expect(await _ingestQueue.getJob(jobId)).toBeUndefined();
    });

    it('translates an enqueue failure into a TRPCError', async () => {
      const { jobId, uploads } = await presignedBatch();

      // Force the BullMQ edge to fail — the router must surface a TRPCError.
      const spy = vi
        .spyOn(_ingestQueue, 'add')
        .mockRejectedValueOnce(new Error('redis down'));

      await expect(
        createCaller(adminOpts).documents.startIngestJob({ jobId, uploads }),
      ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

      spy.mockRestore();
    });
  });

  describe('delete', () => {
    it('reports zero deletions for a filename that was never indexed', async () => {
      // The vector table is created lazily on first index; ensure it exists so a
      // delete-by-filename against an empty knowledge base returns 0, not errors.
      await ensureVectorIndex();
      const filename = `never-${crypto.randomUUID()}.pdf`;
      const result = await createCaller(adminOpts).documents.delete({
        filename,
      });

      expect(result).toEqual({ deletedCount: 0, filename });
    });
  });
});
