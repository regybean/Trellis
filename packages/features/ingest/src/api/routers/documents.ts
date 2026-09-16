import { randomUUID } from 'node:crypto';
import { tracked, TRPCError } from '@trpc/server';

import { logger } from '@acme/logger';
import { env as ragEnv } from '@acme/rag/env';
import { mapDataSourceOwnershipError } from '@acme/rag/ownership-trpc';
import {
  assertDataSourceOwned,
  countDocuments,
  deleteDocument,
  listDataSources,
  listDocuments,
} from '@acme/rag/server';

import { generatePresignedUploadUrl } from '../../utils/s3-client';
import {
  deleteDocumentSchema,
  getPresignedUrlsSchema,
  listDocumentsSchema,
  progressReaderSchema,
  startIngestJobSchema,
} from '../schemas/ingest-schema';
import { readProgressSnapshot } from '../services/ingest-progress-snapshot';
import { tailIngestProgress } from '../services/ingest-progress-stream';
import { enqueueIngestJob } from '../services/ingest-queue';
import { createTRPCRouter, protectedProcedure } from '../trpc';

/**
 * Assert the caller owns a Data Source, as a caller-visible FORBIDDEN.
 *
 * Every procedure below that names a specific Source runs this first. The
 * alternative — relying on `owner_id` being in the underlying predicate, so a
 * foreign Source simply matches nothing — is safe but silent: `delete` would
 * report zero deletions and `list` an empty Source, both of which read as "it
 * worked" to the caller and to a reviewer.
 */
async function assertOwned(ownerId: string, dataSourceId: string) {
  try {
    await assertDataSourceOwned({ ownerId, dataSourceIds: [dataSourceId] });
  } catch (error) {
    mapDataSourceOwnershipError(error);
  }
}

/**
 * The quota rejection, in the caller's terms: what is left, not what the limit
 * is. Naming the headroom is what lets the client trim its own batch on the
 * retry instead of guessing.
 */
function capMessage(cap: number, headroom: number) {
  if (headroom === 0) return `This data source is full (${cap} documents).`;
  const plural = headroom === 1 ? '' : 's';
  return `This data source has room for ${headroom} more document${plural}.`;
}

export const documentsRouter = createTRPCRouter({
  /**
   * The caller's Documents, optionally narrowed to one Data Source, each row
   * carrying its Source's name for the `All documents` roll-up.
   *
   * The name is joined here rather than in rag because the two halves live in
   * different databases — `data_source` in the app one, the chunk mirror in the
   * vector one — so this is two owner-scoped reads composed, not a query
   * ingest is running itself. Documents whose Source is absent are dropped: the
   * only way to produce one is the cascade's residual window (chunks orphaned
   * between the two deletes), and those are unreachable ballast rather than a
   * row a user can stand in.
   */
  list: protectedProcedure
    .input(listDocumentsSchema)
    .query(async ({ ctx, input }) => {
      const ownerId = ctx.session.user.id;
      if (input.dataSourceId) await assertOwned(ownerId, input.dataSourceId);

      const [documents, sources] = await Promise.all([
        listDocuments({ ownerId, dataSourceId: input.dataSourceId }),
        listDataSources({ ownerId }),
      ]);

      const nameById = new Map(sources.map((s) => [s.id, s.name]));
      return documents.flatMap((doc) => {
        const dataSourceName = nameById.get(doc.dataSourceId);
        return dataSourceName ? [{ ...doc, dataSourceName }] : [];
      });
    }),

  /**
   * Server-mint the Job identity and return one presigned PUT URL per file so the
   * browser can upload directly to S3 (bypassing the Next.js body size limit).
   * `jobId` (the BullMQ dedup key) + per-file `uploadId` are minted here so the
   * client never invents them; the S3 key nests both so same-named files in one
   * Job don't collide: `uploads/${jobId}/${uploadId}/${filename}`.
   *
   * This is the choke point, and it is the quota's AUTHORITATIVE enforcement
   * site. The client's own cap check is advisory and is assumed never to have
   * run, because a direct tRPC call bypasses the UI entirely — so the count is
   * re-read from the database here, on every call.
   *
   * The check is `existing + N <= cap` and it rejects the WHOLE batch, naming
   * the remaining headroom. Admitting the files that fit would force the client
   * to reconcile which of its files got URLs, and the point of checking at
   * presign is that it sits before any object or embedding spend exists.
   */
  getPresignedUploadUrls: protectedProcedure
    .input(getPresignedUrlsSchema)
    .mutation(async ({ ctx, input }) => {
      const { id: userId } = ctx.session.user;
      const { dataSourceId } = input;
      await assertOwned(userId, dataSourceId);

      const cap = ragEnv.MAX_DOCUMENTS_PER_DATA_SOURCE;
      const existing = await countDocuments({ ownerId: userId, dataSourceId });
      if (existing + input.files.length > cap) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: capMessage(cap, Math.max(cap - existing, 0)),
        });
      }

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
        { userId, jobId, dataSourceId, fileCount: input.files.length },
        'Generated presigned upload URLs',
      );

      return { jobId, uploads };
    }),

  /**
   * Enqueue the async ingest Job for a batch already uploaded to S3. Fire-and-
   * forget: validate the client-echoed ids, assert the destination Source is the
   * caller's, enqueue one BullMQ job, and return immediately. The worker streams
   * per-file progress; a completion notification signals the end. Enqueue
   * failure surfaces as a `TRPCError` with no S3 cleanup (the objects stay for a
   * manual rerun).
   *
   * The destination is echoed by the client rather than held server-side
   * between the two calls, so a caller could presign against one of their
   * Sources and enqueue into another. That is a quota bypass on the caller's own
   * Sources and nothing more — the ownership assert here is what keeps it from
   * being anything else, and `uploadDoc` re-asserts again before each upsert.
   * The cap is deliberately NOT re-checked: it has one authoritative site, and a
   * second would make the presign rejection the thing nobody trusts.
   */
  startIngestJob: protectedProcedure
    .input(startIngestJobSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { jobId, dataSourceId, uploads } = input;
      await assertOwned(userId, dataSourceId);

      // Cheap integrity guard: every echoed key must live under this Job's
      // prefix. `jobId` is a server-minted random uuid handed only to the
      // caller who presigned it, so this is a typo/tamper guard on the caller's
      // own batch, not the ownership check — that is the assert above.
      const prefix = `uploads/${jobId}/`;
      const stray = uploads.find((u) => !u.s3Key.startsWith(prefix));
      if (stray) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `s3Key does not belong to job ${jobId}: ${stray.s3Key}`,
        });
      }

      try {
        await enqueueIngestJob({ jobId, userId, dataSourceId, uploads });
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
        { userId, jobId, dataSourceId, fileCount: uploads.length },
        'Ingest job enqueued',
      );
      return { jobId };
    }),

  /**
   * Cold-mount seed: fold the caller's retained progress Stream to the latest
   * stage per in-flight/`failed` Upload plus a resume cursor. This is how
   * progress survives a refresh — the client seeds its rows from here, then
   * opens `progress` with `sinceId = lastId`. `done` Uploads are dropped (they
   * live in `documents.list`), so a completed file never re-seeds as a
   * duplicate row. The stream key is the caller's own id, so this is
   * owner-scoped by construction — there is no id to pass and none to validate.
   */
  progressSnapshot: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    return readProgressSnapshot(userId);
  }),

  /**
   * Pure, stateless tail of the caller's per-user progress Stream — no writes, no
   * lock, no terminal. `userId` comes from ctx (never the client). Re-emits each
   * Redis entry via tRPC `tracked(id, event)` so a transiently-reconnecting client
   * (passing `lastEventId`) resumes strictly after it; a fresh mount resumes from
   * the snapshot's `lastId` (`sinceId`). Closes only on abort (the stream carries
   * no per-Job terminal).
   */
  progress: protectedProcedure
    .input(progressReaderSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      const userId = ctx.session.user.id;

      logger.info(
        { userId, lastEventId: input.lastEventId, sinceId: input.sinceId },
        'documents.progress: reader attached',
      );

      for await (const { id, event } of tailIngestProgress(
        userId,
        { lastEventId: input.lastEventId, sinceId: input.sinceId },
        signal,
      )) {
        yield tracked(id, event);
      }
    }),

  /** Delete one Document — every chunk of this filename in this Source. */
  delete: protectedProcedure
    .input(deleteDocumentSchema)
    .mutation(async ({ ctx, input }) => {
      const ownerId = ctx.session.user.id;
      await assertOwned(ownerId, input.dataSourceId);

      return deleteDocument({
        ownerId,
        dataSourceId: input.dataSourceId,
        fileName: input.filename,
      });
    }),
});
