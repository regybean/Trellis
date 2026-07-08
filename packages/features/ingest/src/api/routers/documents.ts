import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { logger } from '@acme/logger';
import { deleteByFilename, listDocuments, uploadDocs } from '@acme/rag/server';

import {
  deleteFilesFromS3,
  downloadFileFromS3,
  generatePresignedUploadUrl,
} from '../../utils/s3-client';
import {
  deleteDocumentSchema,
  getPresignedUrlsSchema,
  uploadFromS3Schema,
} from '../schemas/documents-schema';
import { adminProcedure, createTRPCRouter } from '../trpc';

export const documentsRouter = createTRPCRouter({
  /** List indexed documents grouped by filename. */
  list: adminProcedure.input(z.void()).query(async () => {
    return listDocuments();
  }),

  /**
   * Get presigned PUT URLs so the browser can upload files directly to S3,
   * bypassing the Next.js request body size limit.
   */
  getPresignedUploadUrls: adminProcedure
    .input(getPresignedUrlsSchema)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      const uploadId = crypto.randomUUID();
      const presignedUrls = await Promise.all(
        input.files.map(async (file) => {
          const key = `uploads/${uploadId}/${file.filename}`;
          const uploadUrl = await generatePresignedUploadUrl(
            key,
            file.contentType,
          );
          return { filename: file.filename, key, uploadUrl };
        }),
      );

      logger.info(
        { userId, uploadId, fileCount: input.files.length },
        'Generated presigned upload URLs',
      );

      return { uploadId, presignedUrls };
    }),

  /** Download the S3 objects, index them into the document store, then clean up. */
  uploadFromS3: adminProcedure
    .input(uploadFromS3Schema)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;
      const { s3Keys } = input;

      try {
        const files = await Promise.all(
          s3Keys.map(async (s3Key) => {
            const { buffer, contentType } = await downloadFileFromS3(s3Key);
            const filename = s3Key.split('/').pop() ?? 'unknown';
            return new File([buffer], filename, { type: contentType });
          }),
        );

        await uploadDocs(files);

        await deleteFilesFromS3(s3Keys).catch((error) =>
          logger.warn({ error }, 'Failed to clean up S3 files after upload'),
        );

        logger.info({ userId, fileCount: files.length }, 'Documents indexed');
      } catch (error) {
        await deleteFilesFromS3(s3Keys).catch(() => {
          // ignore cleanup failure
        });
        logger.error({ err: error, userId }, 'Failed to index documents');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to process uploaded files',
          cause: error,
        });
      }
    }),

  /** Delete every chunk belonging to a filename. */
  delete: adminProcedure
    .input(deleteDocumentSchema)
    .mutation(async ({ input }) => {
      return deleteByFilename(input.filename);
    }),
});
