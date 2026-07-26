import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Ingest config-as-code (ADR 0026). The S3 region, endpoint and upload bucket
 * are non-sensitive, per-deploy-target values — the endpoint is the canonical
 * profile example: LocalStack in development, the real AWS endpoint (empty → SDK
 * default) in staging/production. The AWS credentials stay in `env.ts` (secrets).
 * Server-side — the S3 client runs on the backend.
 */
export function ingestConfig(context: ConfigContext) {
  return createConfig({
    server: {
      AWS_REGION: z.string().nonempty(),
      // Empty string → no endpoint override (the SDK's default AWS endpoint).
      // Set to a LocalStack URL in development; empty in staging/production.
      S3_ENDPOINT: z.string(),
      S3_UPLOAD_BUCKET: z.string().nonempty(),
    },
    profiles: {
      default: {
        server: {
          AWS_REGION: 'eu-west-2',
          S3_ENDPOINT: 'http://localhost:4566',
          S3_UPLOAD_BUCKET: 'upload-temp-bucket',
        },
      },
      staging: { server: { S3_ENDPOINT: '' } },
      production: { server: { S3_ENDPOINT: '' } },
    },
    context,
  });
}
