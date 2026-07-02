'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
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
 * Deep module for the three-step Document upload protocol
 * (presign → direct S3 PUT → server-side index), behind a small interface:
 *   `{ upload, status, accept }`.
 *
 * Components stay UI-only (see CLAUDE.md — business logic lives in hooks).
 *
 * Failure handling: if any S3 PUT rejects we abort before indexing, so no
 * partial Document set is indexed. We surface which files failed. Objects that
 * did upload before the failure are orphaned in S3 and reaped by the bucket's
 * lifecycle rule — there is no client-callable S3 cleanup procedure, and
 * indexing a partial set would be worse than a short-lived orphan.
 */
export function useDocumentUpload() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
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

  const index = useMutation(
    trpc.documents.uploadFromS3.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.documents.list.pathFilter());
        toast.success('Documents uploaded successfully');
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
      const { presignedUrls } = await presign.mutateAsync({
        files: files.map((file) => ({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        })),
      });

      const results = await Promise.allSettled(
        files.map((file, i) => {
          const presigned = presignedUrls.at(i);
          if (!presigned) {
            throw new Error(`No presigned URL for file: ${file.name}`);
          }
          return putFileToS3(file, presigned.uploadUrl);
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

      await index.mutateAsync({ s3Keys: presignedUrls.map((p) => p.key) });
    } catch (error) {
      reportError(error);
    }
  };

  const status: UploadStatus =
    presign.isPending || index.isPending ? 'uploading' : 'idle';

  return {
    upload,
    status,
    accept: ACCEPTED_EXTENSIONS.join(','),
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  };
}
