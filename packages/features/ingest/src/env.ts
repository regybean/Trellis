import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, webappSchema, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Ingest's environment, declared once (@acme/env ADR 0001) — composed into an app's env
 * graph via `extends: [ingestEnv(), …]`.
 *
 * **Config** — the S3 region, endpoint and upload bucket, plus the progress-stream
 * and worker tunables, carry profile values. `S3_ENDPOINT` is the canonical
 * profile example: LocalStack in development, the SDK's default AWS endpoint
 * (empty) in staging/production. Every one of them is env-overridable (@acme/env ADR 0001
 * §4), which is what a real deploy needs — a bucket name is per-environment data,
 * not a value worth a commit.
 *
 * **Secrets** — the raw AWS credentials. The development profile authors the
 * LocalStack dummy pair (any string authenticates against LocalStack), so a clean
 * checkout uploads with no `.env` rows; the staging/production overlays
 * **unauthor** them, which makes them secrets on those targets by the same
 * mechanical rule as every other secret. That is the one way to say "config in
 * development, credential in production", because every overlay merges over the
 * development base.
 *
 * `MAX_FILE_SIZE_BYTES` and `ACCEPTED_EXTENSIONS` deliberately stay code constants
 * in `lib/upload-validation.ts`: env-invariant validation limits read in a
 * client-safe barrel.
 */
export function ingestEnv() {
  return createEnv({
    clientPrefix: 'NEXT_PUBLIC_',
    client: {},
    shared: {
      NODE_ENV: z.enum(['development', 'production', 'test']),
      // Per-app identity — Postgres/pgvector schema + Redis prefix.
      NEXT_PUBLIC_WEBAPP: webappSchema,
    },
    server: {
      AWS_REGION: z.string().nonempty(),
      // Empty string → no endpoint override (the SDK's default AWS endpoint).
      // Set to a LocalStack URL in development; empty in staging/production.
      S3_ENDPOINT: z.string(),
      S3_UPLOAD_BUCKET: z.string().nonempty(),
      // Per-user progress-stream tunables. The rolling TTL the writer refreshes on
      // every stage transition, so an abandoned job's stream self-expires; nothing
      // ever deletes the key. The reader's idle poll backoff (min → max, snap back
      // to min when a batch arrives) — it tails XRANGE on the shared connection,
      // so it must never block.
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
      // The raw AWS credentials — authored for LocalStack in development,
      // unauthored (and therefore demanded) on every real target.
      //
      // `@acme/models` also declares this pair (as pure secrets, for Bedrock).
      // Same variable, one value per process: they agree on staging/production,
      // where both are unauthored. They can only diverge in development, and only
      // if Bedrock is selected there. The names are the AWS SDK provider chain's, so
      // aliasing them apart would validate a variable the SDK never reads.
      AWS_ACCESS_KEY_ID: z.string().nonempty(),
      AWS_SECRET_ACCESS_KEY: z.string().nonempty(),
    },
    createFinalSchema: (shape) =>
      withProfiles(shape, appEnv, {
        default: {
          NODE_ENV: 'development',
          AWS_REGION: 'eu-west-2',
          S3_ENDPOINT: 'http://localhost:4566',
          S3_UPLOAD_BUCKET: 'upload-temp-bucket',
          INGEST_PROGRESS_TTL_SECONDS: 3600,
          INGEST_PROGRESS_POLL_MIN_MS: 100,
          INGEST_PROGRESS_POLL_MAX_MS: 1000,
          INGEST_CONCURRENCY: 4,
          QUEUE_REMOVE_ON_COMPLETE: 1000,
          QUEUE_REMOVE_ON_FAIL: 1000,
          // LocalStack authenticates any credential pair; these are the dummy
          // values it expects, not a secret.
          AWS_ACCESS_KEY_ID: 'test',
          AWS_SECRET_ACCESS_KEY: 'test',
        },
        // `S3_ENDPOINT: ''` is authored, not inherited: an empty endpoint is what
        // selects the SDK's default AWS host, and inheriting development's
        // LocalStack URL would point a real deploy at localhost. The credentials
        // are unauthored for the same class of reason — inheriting `test` would
        // make a real deploy fail on its first S3 call instead of at boot.
        staging: {
          S3_ENDPOINT: '',
          AWS_ACCESS_KEY_ID: undefined,
          AWS_SECRET_ACCESS_KEY: undefined,
        },
        production: {
          S3_ENDPOINT: '',
          AWS_ACCESS_KEY_ID: undefined,
          AWS_SECRET_ACCESS_KEY: undefined,
        },
      }),
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_WEBAPP: process.env.NEXT_PUBLIC_WEBAPP,
      AWS_REGION: readEnv('AWS_REGION'),
      S3_ENDPOINT: readEnv('S3_ENDPOINT'),
      S3_UPLOAD_BUCKET: readEnv('S3_UPLOAD_BUCKET'),
      INGEST_PROGRESS_TTL_SECONDS: readEnv('INGEST_PROGRESS_TTL_SECONDS'),
      INGEST_PROGRESS_POLL_MIN_MS: readEnv('INGEST_PROGRESS_POLL_MIN_MS'),
      INGEST_PROGRESS_POLL_MAX_MS: readEnv('INGEST_PROGRESS_POLL_MAX_MS'),
      INGEST_CONCURRENCY: readEnv('INGEST_CONCURRENCY'),
      QUEUE_REMOVE_ON_COMPLETE: readEnv('QUEUE_REMOVE_ON_COMPLETE'),
      QUEUE_REMOVE_ON_FAIL: readEnv('QUEUE_REMOVE_ON_FAIL'),
      AWS_ACCESS_KEY_ID: readEnv('AWS_ACCESS_KEY_ID'),
      AWS_SECRET_ACCESS_KEY: readEnv('AWS_SECRET_ACCESS_KEY'),
    },
    emptyStringAsUndefined: true,
  });
}

export const env = ingestEnv();
