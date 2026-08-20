import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Ingest config-as-code (ADR 0026). The S3 region, endpoint and upload bucket
 * are non-sensitive, per-deploy-target values — the endpoint is the canonical
 * profile example: LocalStack in development, the real AWS endpoint (empty → SDK
 * default) in staging/production. The AWS credentials stay in `env.ts` (secrets).
 * Server-side — the S3 client runs on the backend.
 *
 * `MAX_FILE_SIZE_BYTES` and `ACCEPTED_EXTENSIONS` deliberately stay code
 * constants in `lib/upload-validation.ts`: env-invariant validation limits read
 * in a client-safe barrel (ADR 0026 phase 3, "leave structural constants as code").
 */
export function ingestConfig(context: ConfigContext) {
  return createConfig({
    server: {
      AWS_REGION: z.string().nonempty(),
      // Empty string → no endpoint override (the SDK's default AWS endpoint).
      // Set to a LocalStack URL in development; empty in staging/production.
      S3_ENDPOINT: z.string(),
      S3_UPLOAD_BUCKET: z.string().nonempty(),
      // Per-user progress-stream tunables (ADR 0026). The rolling TTL the writer
      // refreshes on every stage transition, so an abandoned job's stream self-
      // expires; nothing ever deletes the key. The reader's idle poll backoff
      // (min → max, snap back to min when a batch arrives) — it tails XRANGE on
      // the shared connection, so it must never block.
      INGEST_PROGRESS_TTL_SECONDS: z.coerce.number().int().positive(),
      INGEST_PROGRESS_POLL_MIN_MS: z.coerce.number().int().positive(),
      INGEST_PROGRESS_POLL_MAX_MS: z.coerce.number().int().positive(),
      // Worker fan-out width. The processor runs `uploadDoc` under a `p-limit` of
      // this many slots and downloads each file INSIDE its slot, so peak memory is
      // bounded to this many files in flight (never the whole batch at once).
      INGEST_CONCURRENCY: z.coerce.number().int().positive(),
      // BullMQ job-retention counts (mirrors chat). No `attempts`/`backoff` —
      // ingest never auto-retries; `jobId` dedup only guards a manual re-upload.
      QUEUE_REMOVE_ON_COMPLETE: z.coerce.number().int().nonnegative(),
      QUEUE_REMOVE_ON_FAIL: z.coerce.number().int().nonnegative(),
    },
    profiles: {
      default: {
        server: {
          AWS_REGION: 'eu-west-2',
          S3_ENDPOINT: 'http://localhost:4566',
          S3_UPLOAD_BUCKET: 'upload-temp-bucket',
          INGEST_PROGRESS_TTL_SECONDS: 3600,
          INGEST_PROGRESS_POLL_MIN_MS: 100,
          INGEST_PROGRESS_POLL_MAX_MS: 1000,
          INGEST_CONCURRENCY: 4,
          QUEUE_REMOVE_ON_COMPLETE: 1000,
          QUEUE_REMOVE_ON_FAIL: 1000,
        },
      },
      staging: { server: { S3_ENDPOINT: '' } },
      production: { server: { S3_ENDPOINT: '' } },
    },
    context,
  });
}
