import { z } from 'zod/v4';

// Request presigned upload URLs for a set of files.
export const getPresignedUrlsSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1, 'Filename is required'),
        contentType: z.string().min(1, 'Content type is required'),
      }),
    )
    .min(1, 'At least one file is required'),
});
export type GetPresignedUrlsInput = z.infer<typeof getPresignedUrlsSchema>;

// Index files that have already been uploaded to S3.
export const uploadFromS3Schema = z.object({
  s3Keys: z.array(z.string()).min(1, 'At least one S3 key is required'),
});
export type UploadFromS3Input = z.infer<typeof uploadFromS3Schema>;

export const deleteDocumentSchema = z.object({
  filename: z.string().min(1),
});
export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;
