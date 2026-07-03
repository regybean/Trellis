/**
 * Documents Router Tests
 *
 * Testing philosophy:
 * - Test auth/middleware ONCE (every procedure uses adminProcedure).
 * - Focus on the orchestration logic: presigned-URL fan-out, S3 download →
 *   index → cleanup, and the failure path that still cleans up.
 * - Mock only the external edges: the document store and the S3 client.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteByFilename, listDocuments, uploadDocs } from '@acme/rag/server';

import type { TestContextOptions } from '../../utils/test-context';
import { appRouter } from '../../../../api/root';
import {
  deleteFilesFromS3,
  downloadFileFromS3,
  generatePresignedUploadUrl,
} from '../../../../utils/s3-client';
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

describe('documentsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('middleware (tested once)', () => {
    it('rejects non-admin users', async () => {
      const caller = createCaller({ ...adminOpts, role: 'user' });

      await expect(caller.documents.list()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('list', () => {
    it('returns an empty list when nothing is indexed', async () => {
      vi.mocked(listDocuments).mockResolvedValue([]);

      const result = await createCaller(adminOpts).documents.list();

      expect(result).toEqual([]);
    });

    it('returns indexed documents', async () => {
      const docs = [
        { filename: 'a.pdf', count: 3, uploadTimestamp: 1 },
        { filename: 'b.txt', count: 1, uploadTimestamp: 2 },
      ];
      vi.mocked(listDocuments).mockResolvedValue(docs);

      const result = await createCaller(adminOpts).documents.list();

      expect(result).toEqual(docs);
    });
  });

  describe('getPresignedUploadUrls', () => {
    it('returns one presigned URL per file, keyed under a shared uploadId', async () => {
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

      expect(result.presignedUrls).toHaveLength(2);
      expect(generatePresignedUploadUrl).toHaveBeenCalledTimes(2);
      // All keys share the single uploadId prefix.
      for (const { key } of result.presignedUrls) {
        expect(key).toBe(`uploads/${result.uploadId}/${key.split('/').pop()}`);
      }
      expect(result.presignedUrls.map((p) => p.filename)).toEqual([
        'a.pdf',
        'b.txt',
      ]);
    });
  });

  describe('uploadFromS3', () => {
    it('downloads, indexes, then cleans up the S3 objects', async () => {
      vi.mocked(downloadFileFromS3).mockResolvedValue({
        buffer: Buffer.from('hello'),
        contentType: 'application/pdf',
      });
      vi.mocked(uploadDocs).mockResolvedValue(undefined);
      vi.mocked(deleteFilesFromS3).mockResolvedValue(undefined);

      const s3Keys = ['uploads/u1/a.pdf', 'uploads/u1/b.pdf'];
      await createCaller(adminOpts).documents.uploadFromS3({ s3Keys });

      expect(downloadFileFromS3).toHaveBeenCalledTimes(2);
      expect(uploadDocs).toHaveBeenCalledOnce();
      const uploaded = vi.mocked(uploadDocs).mock.calls[0]?.[0];
      expect(uploaded).toHaveLength(2);
      expect(uploaded?.[0]).toBeInstanceOf(File);
      expect(uploaded?.[0]?.name).toBe('a.pdf');
      expect(deleteFilesFromS3).toHaveBeenCalledWith(s3Keys);
    });

    it('still cleans up S3 and throws INTERNAL_SERVER_ERROR when indexing fails', async () => {
      vi.mocked(downloadFileFromS3).mockResolvedValue({
        buffer: Buffer.from('hello'),
        contentType: 'application/pdf',
      });
      vi.mocked(uploadDocs).mockRejectedValue(new Error('index boom'));
      vi.mocked(deleteFilesFromS3).mockResolvedValue(undefined);

      const s3Keys = ['uploads/u1/a.pdf'];
      await expect(
        createCaller(adminOpts).documents.uploadFromS3({ s3Keys }),
      ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });

      expect(deleteFilesFromS3).toHaveBeenCalledWith(s3Keys);
    });
  });

  describe('delete', () => {
    it('deletes every chunk for a filename', async () => {
      vi.mocked(deleteByFilename).mockResolvedValue({
        deletedCount: 3,
        filename: 'a.pdf',
      });

      const result = await createCaller(adminOpts).documents.delete({
        filename: 'a.pdf',
      });

      expect(deleteByFilename).toHaveBeenCalledWith('a.pdf');
      expect(result).toEqual({ deletedCount: 3, filename: 'a.pdf' });
    });
  });
});
