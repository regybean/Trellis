/**
 * S3 client for direct browser uploads via presigned URLs.
 *
 * The presigned-URL approach bypasses Next.js body size limits:
 * 1. Frontend requests a presigned PUT URL from the backend.
 * 2. Frontend uploads the file directly to S3 using that URL.
 * 3. Frontend notifies the backend with the S3 keys to process.
 * 4. Backend downloads the files from S3, indexes them, then cleans up.
 *
 * Works with LocalStack in development (set S3_ENDPOINT=http://localhost:4566)
 * and real AWS S3 in production.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { logger } from '@acme/logger';

import { env } from '../env';

export const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
  // AWS SDK >=3.729 defaults requestChecksumCalculation to WHEN_SUPPORTED, which
  // bakes a CRC32 of an EMPTY body into presigned PUT URLs. The browser then PUTs
  // real bytes -> checksum mismatch -> 400 InvalidRequest. Browser PUTs can't join
  // the checksum protocol; disable it (TLS covers transit, server re-parses on
  // download). Don't "tidy" this away — it breaks direct uploads.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  ...(env.S3_ENDPOINT && {
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true, // Required for LocalStack
  }),
});

/** Generate a presigned PUT URL for a direct browser upload. */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
) {
  const command = new PutObjectCommand({
    Bucket: env.S3_UPLOAD_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });
  logger.debug({ key, contentType }, 'Generated presigned upload URL');
  return uploadUrl;
}

/** Download a file from S3 as a Buffer. */
export async function downloadFileFromS3(key: string) {
  const command = new GetObjectCommand({
    Bucket: env.S3_UPLOAD_BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);
  if (!response.Body) {
    throw new Error(`No body returned for S3 object: ${key}`);
  }

  const buffer = await response.Body.transformToByteArray();
  logger.debug({ key, size: buffer.length }, 'Downloaded file from S3');

  return {
    buffer: Buffer.from(buffer),
    contentType: response.ContentType ?? 'application/octet-stream',
  };
}

/** Delete a single file from S3. */
export async function deleteFileFromS3(key: string) {
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: env.S3_UPLOAD_BUCKET, Key: key }),
  );
  logger.debug({ key }, 'Deleted file from S3');
}

/** Delete multiple files from S3. */
export async function deleteFilesFromS3(keys: string[]) {
  await Promise.all(keys.map((key) => deleteFileFromS3(key)));
  logger.debug({ count: keys.length }, 'Deleted multiple files from S3');
}
