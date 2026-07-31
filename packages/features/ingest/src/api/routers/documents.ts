import { randomUUID } from 'node:crypto';
import { tracked, TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { logger } from '@acme/logger';
import { deleteByFilename, listDocuments } from '@acme/rag/server';

import { generatePresignedUploadUrl } from '../../utils/s3-client';
import {
  deleteDocumentSchema,
  getPresignedUrlsSchema,
  progressReaderSchema,
  startIngestJobSchema,
} from '../schemas/ingest-schema';
import { tailIngestProgress } from '../services/ingest-progress-reader';
import { enqueueIngestJob } from '../services/ingest-queue';
import { adminProcedure, createTRPCRouter } from '../trpc';

// `adminProcedure` checks the role but doesn't narrow `userId` off the auth
// union. An admin is always authenticated, so narrow it here (a client can only
// act on / tail its own stream) before it's used as a Redis-key segment.
function requireUserId(userId: string | null | undefined) {
  if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return userId;
}

export const documentsRouter = createTRPCRouter({
  /** List indexed documents grouped by filename. */
  list: adminProcedure.input(z.void()).query(async () => {
    return listDocuments();
  }),

  /**
   * Server-mint the Job identity and return one presigned PUT URL per file so the
   * browser can upload directly to S3 (bypassing the Next.js body size limit).
   * `jobId` (the BullMQ dedup key) + per-file `uploadId` are minted here so the
   * client never invents them; the S3 key nests both so same-named files in one
   * Job don't collide: `uploads/${jobId}/${uploadId}/${filename}`.
   */
  getPresignedUploadUrls: adminProcedure
    .input(getPresignedUrlsSchema)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;

      // Annotated `string` so the branded UUID template type doesn't leak into
      // the wire contract — clients receive plain strings.
      const jobId: string = randomUUID();
      const uploads = await Promise.all(
        input.files.map(async (file) => {
          const uploadId: string = randomUUID();
          const s3Key = `uploads/${jobId}/${uploadId}/${file.filename}`;
          const uploadUrl = await generatePresignedUploadUrl(
            s3Key,
            file.contentType,
          );
          return { uploadId, filename: file.filename, s3Key, uploadUrl };
        }),
      );

      logger.info(
        { userId, jobId, fileCount: input.files.length },
        'Generated presigned upload URLs',
      );

      return { jobId, uploads };
    }),

  /**
   * Enqueue the async ingest Job for a batch already uploaded to S3. Fire-and-
   * forget: validate the client-echoed ids (admin-only, so `s3Key` is trusted
   * after a cheap `jobId`-prefix guard — no S3 HEAD), enqueue one BullMQ job, and
   * return immediately. The worker streams per-file progress; a completion
   * notification signals the end. Enqueue failure surfaces as a `TRPCError` with
   * no S3 cleanup (the objects stay for a manual rerun).
   */
  startIngestJob: adminProcedure
    .input(startIngestJobSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = requireUserId(ctx.auth.userId);
      const { jobId, uploads } = input;

      // Cheap integrity guard: every echoed key must live under this Job's prefix.
      // Admin-only, so this is a typo/tamper guard, not an ownership check.
      const prefix = `uploads/${jobId}/`;
      const stray = uploads.find((u) => !u.s3Key.startsWith(prefix));
      if (stray) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `s3Key does not belong to job ${jobId}: ${stray.s3Key}`,
        });
      }

      try {
        await enqueueIngestJob({ jobId, userId, uploads });
      } catch (error) {
        logger.error(
          { err: error, userId, jobId },
          'Failed to enqueue ingest job',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to start ingest job',
          cause: error,
        });
      }

      logger.info(
        { userId, jobId, fileCount: uploads.length },
        'Ingest job enqueued',
      );
      return { jobId };
    }),

  /**
   * Pure, stateless tail of the caller's per-user progress Stream — no writes, no
   * lock, no terminal. `userId` comes from ctx (never the client). Re-emits each
   * Redis entry via tRPC `tracked(id, event)` so a transiently-reconnecting client
   * (passing `lastEventId`) resumes strictly after it; a fresh mount tails from
   * now. Closes only on abort (the stream carries no per-Job terminal).
   */
  progress: adminProcedure
    .input(progressReaderSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      const userId = requireUserId(ctx.auth.userId);

      logger.info(
        { userId, lastEventId: input.lastEventId },
        'documents.progress: reader attached',
      );

      for await (const { id, event } of tailIngestProgress(
        userId,
        input.lastEventId ?? null,
        signal,
      )) {
        yield tracked(id, event);
      }
    }),

  /** Delete every chunk belonging to a filename. */
  delete: adminProcedure
    .input(deleteDocumentSchema)
    .mutation(async ({ input }) => {
      return deleteByFilename(input.filename);
    }),
});
