'use client';

import { useMutation } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';

import {
  ACCEPTED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  validateFiles,
} from '../lib/upload-validation';
import { useTRPC } from '../trpc/react';

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

export type UploadStatus = 'idle' | 'uploading';

/**
 * Deep module for the async Document upload protocol
 * (presign → direct S3 PUT → enqueue ingest Job), behind a small interface:
 *   `{ upload, status, accept }`.
 *
 * Components stay UI-only (see CLAUDE.md — business logic lives in hooks).
 *
 * `status` is the CLIENT-side phase only — `uploading` covers presign + the S3
 * PUTs + the `startIngestJob` enqueue, then returns to `idle`. Indexing now runs
 * async in a worker; live per-file progress + completion arrive via the progress
 * subscription + a notification, wired in #189 (not this hook).
 *
 * Failure handling: if any S3 PUT rejects we abort before enqueuing, so no
 * partial batch is indexed. We surface which files failed. Objects that did
 * upload before the failure are orphaned in S3 and reaped by the bucket's
 * lifecycle rule — there is no client-callable S3 cleanup procedure.
 */
export function useDocumentUpload() {
  const trpc = useTRPC();
  const handleGenericError = useGenericErrorHandler();

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
    trpc.documents.startIngestJob.mutationOptions({
      onSuccess: () => {
        toast.success('Upload started — indexing in the background');
      },
      onError: reportError,
    }),
  );

  const upload = async (files: File[]) => {
    if (files.length === 0) return;

    const validationErrors = validateFiles(files);
    if (validationErrors.length > 0) {
      toast.error(validationErrors.join('\n'), { autoClose: 6000 });
      return;
    }

    try {
      const { jobId, uploads } = await presign.mutateAsync({
        files: files.map((file) => ({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        })),
      });

      const results = await Promise.allSettled(
        files.map((file, i) => {
          const target = uploads.at(i);
          if (!target) {
            throw new Error(`No presigned URL for file: ${file.name}`);
          }
          return putFileToS3(file, target.uploadUrl);
        }),
      );

      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      if (failed.length > 0) {
        throw new Error(
          failed
            .map((r) => {
              const reason: unknown = r.reason;
              return reason instanceof Error ? reason.message : String(reason);
            })
            .join('\n'),
        );
      }

      await start.mutateAsync({
        jobId,
        uploads: uploads.map((u) => ({
          uploadId: u.uploadId,
          filename: u.filename,
          s3Key: u.s3Key,
        })),
      });
    } catch (error) {
      reportError(error);
    }
  };

  const status: UploadStatus =
    presign.isPending || start.isPending ? 'uploading' : 'idle';

  return {
    upload,
    status,
    accept: ACCEPTED_EXTENSIONS.join(','),
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  };
}
