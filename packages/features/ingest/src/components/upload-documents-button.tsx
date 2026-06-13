'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';
import { Button } from '@acme/ui';

import { useTRPC } from '../trpc/react';

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt'];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

function validateFiles(files: File[]): string[] {
  const errors: string[] = [];
  for (const file of files) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      errors.push(`Unsupported file format: ${file.name}`);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      errors.push(`File too large (max 50MB): ${file.name}`);
    }
  }
  return errors;
}

/** Upload a single file directly to S3 using a presigned URL. */
async function uploadFileToS3(file: File, presignedUrl: string) {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!response.ok) {
    throw new Error(`Failed to upload ${file.name}: ${response.statusText}`);
  }
}

export function UploadDocumentsButton() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const genericErrorHandle = useGenericErrorHandler();
  const [isUploading, setIsUploading] = useState(false);

  const handleUploadError = useCallback(
    (error: unknown) => {
      setIsUploading(false);
      if (error instanceof TRPCClientError || error instanceof Error) {
        toast.error(error.message, { autoClose: 6000, closeButton: true });
      } else {
        genericErrorHandle();
      }
    },
    [genericErrorHandle],
  );

  const getPresignedUrls = useMutation(
    trpc.documents.getPresignedUploadUrls.mutationOptions({
      onError: handleUploadError,
    }),
  );

  const uploadFromS3 = useMutation(
    trpc.documents.uploadFromS3.mutationOptions({
      onSuccess: () => {
        setIsUploading(false);
        void queryClient.invalidateQueries(trpc.documents.list.pathFilter());
        toast.success('Documents uploaded successfully');
      },
      onError: handleUploadError,
    }),
  );

  const handleFileChange = useCallback(
    async (evt: React.ChangeEvent<HTMLInputElement>) => {
      const files = [...(evt.target.files ?? [])];
      evt.target.value = ''; // allow re-uploading the same file
      if (files.length === 0) return;

      const validationErrors = validateFiles(files);
      if (validationErrors.length > 0) {
        toast.error(validationErrors.join('\n'), { autoClose: 6000 });
        return;
      }

      setIsUploading(true);
      try {
        const { presignedUrls } = await getPresignedUrls.mutateAsync({
          files: files.map((file) => ({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
          })),
        });

        await Promise.all(
          files.map((file, index) => {
            const presigned = presignedUrls.at(index);
            if (!presigned) {
              throw new Error(`No presigned URL for file: ${file.name}`);
            }
            return uploadFileToS3(file, presigned.uploadUrl);
          }),
        );

        uploadFromS3.mutate({ s3Keys: presignedUrls.map((p) => p.key) });
      } catch (error) {
        handleUploadError(error);
      }
    },
    [getPresignedUrls, uploadFromS3, handleUploadError],
  );

  const isPending =
    isUploading || getPresignedUrls.isPending || uploadFromS3.isPending;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(',')}
        onChange={handleFileChange}
        className="hidden"
        id="documents-upload-input"
      />
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={isPending}
        variant="default"
      >
        {isPending ? 'Uploading...' : 'Upload Documents'}
      </Button>
    </>
  );
}
