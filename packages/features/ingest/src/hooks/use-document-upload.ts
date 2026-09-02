'use client';

import { useEffect, useReducer } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { useSubscription } from '@trpc/tanstack-react-query';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';

import {
  ACCEPTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  validateFiles,
} from '../lib/upload-validation';
import { useIngestQueryClient, useTRPC } from '../trpc/react';
import {
  deriveCompletedJobIds,
  deriveFiles,
  deriveSummary,
  ingestProgressReducer,
  initialProgressState,
} from './ingest-progress-reducer';

/** Upload a single file directly to S3 using a presigned URL. */
async function putFileToS3(file: File, presignedUrl: string) {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!response.ok) {
    throw new Error(`Failed to upload ${file.name}: ${response.statusText}`);
  }
}

const reasonMessage = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

/**
 * Deep module for async, live-progress Document ingestion (#180).
 *
 * The three-step upload protocol (presign → direct S3 PUT → `startIngestJob`
 * enqueue) plus the always-on per-user progress subscription are fused behind a
 * flat surface: `{ upload, files, summary, accept, maxFileSizeBytes }`. Live
 * per-file Stage lives in a mount-owned `Record<uploadId, …>` driven by the pure
 * `ingestProgressReducer` — this hook is only wiring (mutations, subscription,
 * one completion effect, request-level toasts). Business logic stays out of
 * components (see CLAUDE.md).
 *
 * Two knowledge sources merge in the reducer: THIS client authors `uploading`
 * (presign → PUT) + optimistic `queued` (on enqueue success); the server authors
 * `parsing`/`embedding`/`done`/`failed` (+ real `queued`) via the subscription.
 *
 * Toast split (#180): request-level failures (validation / presign / enqueue)
 * toast; per-file failures (PUT reject, server `failed`) render in-list, never
 * toasted; the completion toast is DROPPED — it is now the app-level
 * `ingest.job-complete` notification (@acme/notifications).
 */
export function useDocumentUpload() {
  const trpc = useTRPC();
  const queryClient = useIngestQueryClient();
  const handleGenericError = useGenericErrorHandler();
  const [state, dispatch] = useReducer(
    ingestProgressReducer,
    initialProgressState,
  );

  const reportError = (error: unknown) => {
    if (error instanceof TRPCClientError || error instanceof Error) {
      toast.error(error.message, { autoClose: 6000, closeButton: true });
    } else {
      handleGenericError();
    }
  };

  const presign = useMutation(
    trpc.documents.getPresignedUploadUrls.mutationOptions({
      onError: reportError,
    }),
  );

  const start = useMutation(
    trpc.documents.startIngestJob.mutationOptions({ onError: reportError }),
  );

  // Cold-mount seed (#194): fold the retained progress Stream to the latest stage
  // per in-flight/`failed` Upload + a resume cursor. This is what lets progress
  // survive a refresh — without it a fresh mount tailed-from-now into a blank
  // panel. `retry: false` keeps a transient failure from thrashing (the tail still
  // delivers live stages; a missed seed self-heals via seed-on-unknown below).
  //
  // Deliberately NOT `persistMeta`-marked (ADR 0025 is opt-in per query): this is
  // in-flight Upload state whose whole point is to be read fresh from the retained
  // Stream. A persisted copy would re-seed the panel on a cold open with rows that
  // finished hours ago and a `lastId` cursor the Stream has since expired past.
  // Pinned to ingest's client (#82) so it shares the persister-bearing client the
  // completion invalidation below writes to.
  const snapshot = useQuery(
    trpc.documents.progressSnapshot.queryOptions(undefined, { retry: false }),
    queryClient,
  );

  // Seed the reducer when the snapshot lands. Folding an async query into the
  // subscription-fed reducer is the honest seam for an effect. `hydrate` is
  // forward-only + idempotent (unknown id → seed; known id → forward-only merge;
  // a retired `done` row is dropped server-side so it can't re-seed), so it needs
  // no one-shot guard — a re-dispatch on refetch is a no-op the reducer bails on.
  useEffect(() => {
    if (!snapshot.isSuccess) return;
    dispatch({ type: 'hydrate', uploads: snapshot.data.uploads });
  }, [snapshot.isSuccess, snapshot.data]);

  // Progress tail — page-scoped, enabled once the snapshot resolves so it resumes
  // strictly AFTER the snapshot's `lastId` (`sinceId`): snapshot → resume-from-
  // lastId (#194), no replay, no gap, and no `Date.now()` cursor to skew. A live
  // entry for an Upload this mount never saw seeds its own row (seed-on-unknown).
  // SSE, so not drivable in jsdom; reconnect is silent (tRPC retries recoverable
  // drops and replays `lastEventId`).
  useSubscription({
    ...trpc.documents.progress.subscriptionOptions({
      sinceId: snapshot.data?.lastId,
    }),
    enabled: snapshot.isSuccess,
    onData: ({ data: event }) =>
      dispatch(
        event.stage === 'failed'
          ? {
              type: 'serverStage',
              jobId: event.jobId,
              uploadId: event.uploadId,
              filename: event.filename,
              stage: 'failed',
              error: event.error,
            }
          : {
              type: 'serverStage',
              jobId: event.jobId,
              uploadId: event.uploadId,
              filename: event.filename,
              stage: event.stage,
            },
      ),
  });

  const upload = async (files: File[]) => {
    if (files.length === 0) return;

    const validationErrors = validateFiles(files);
    if (validationErrors.length > 0) {
      toast.error(validationErrors.join('\n'), { autoClose: 6000 });
      return;
    }

    // 1. Presign — server mints the jobId + one uploadId per file. A reject is
    //    toasted by the mutation's onError; we just stop.
    let presigned;
    try {
      presigned = await presign.mutateAsync({
        files: files.map((file) => ({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        })),
      });
    } catch {
      return;
    }
    const { jobId, uploads } = presigned;
    dispatch({
      type: 'presigned',
      jobId,
      uploads: uploads.map((u) => ({
        uploadId: u.uploadId,
        filename: u.filename,
      })),
    });

    // 2. Direct browser→S3 PUTs, in parallel. A rejected PUT fails only that file
    //    (in-list); the rest continue — no batch abort (fire-and-forget).
    const results = await Promise.allSettled(
      files.map((file, i) => {
        const target = uploads.at(i);
        if (!target) throw new Error(`No presigned URL for file: ${file.name}`);
        return putFileToS3(file, target.uploadUrl);
      }),
    );

    const puttable: typeof uploads = [];
    for (const [i, result] of results.entries()) {
      const target = uploads.at(i);
      if (!target) continue;
      if (result.status === 'fulfilled') {
        puttable.push(target);
        continue;
      }
      dispatch({
        type: 'putFailed',
        uploadId: target.uploadId,
        error: reasonMessage(result.reason),
      });
    }

    // Every PUT failed — nothing to enqueue; each file already shows in-list.
    if (puttable.length === 0) return;

    // 3. Enqueue ONLY the successfully-PUT uploads (keeps `total` honest). Optimistic
    //    `queued` on success; a whole-batch reject fails those files (not stranded
    //    at `uploading`) — the reject is toasted by onError.
    const uploadIds = puttable.map((u) => u.uploadId);
    try {
      await start.mutateAsync({
        jobId,
        uploads: puttable.map((u) => ({
          uploadId: u.uploadId,
          filename: u.filename,
          s3Key: u.s3Key,
        })),
      });
      dispatch({ type: 'enqueued', uploadIds });
    } catch {
      dispatch({
        type: 'enqueueFailed',
        uploadIds,
        error: 'Failed to start ingest job',
      });
    }
  };

  const files = deriveFiles(state);
  const summary = deriveSummary(files);
  const completedKey = [...deriveCompletedJobIds(files)]
    .toSorted((a, b) => a.localeCompare(b))
    .join(',');

  // The one side-effect: fold server truth back into the documents list once a
  // Job's Uploads have all settled, then RETIRE that Job's `done` rows (#194) so a
  // completed file shows only in the refreshed list, not as a lingering duplicate
  // "Done" row. `failed` rows stay. Keyed on the completed-jobId set, so it fires
  // once per newly-completed Job and is StrictMode-safe (the completion toast is
  // the app-level notification's job, not this hook's).
  useEffect(() => {
    if (completedKey.length === 0) return;
    void queryClient.invalidateQueries(trpc.documents.list.pathFilter());
    dispatch({ type: 'retire', jobIds: completedKey.split(',') });
  }, [completedKey, queryClient, trpc.documents.list]);

  return {
    upload,
    files,
    summary,
    accept: ACCEPTED_EXTENSIONS.join(','),
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  };
}
