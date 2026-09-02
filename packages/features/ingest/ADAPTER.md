# Mounting `@acme/ingest`

A tRPC route, a client provider, a documents page, and a worker. No tables of its
own — uploads land in `@acme/rag`'s knowledge base — so this slice touches the
app's drizzle schema not at all.

The worker is required. The server mints a Job in presign and enqueues one BullMQ
`ingest` job per batch; with no worker, uploads reach S3 and are never indexed.

## Mounted by

All four apps.

- `apps/nextjs` — `src/app/api/trpc/ingest/[trpc]/route.ts`,
  `src/components/pages/layout/persisted-feature-providers.tsx`,
  `src/components/admin/admin-dashboard.tsx`, `src/env.ts`, `worker.ts`
- `apps/nextjs-slim` — `src/app/api/trpc/ingest/[trpc]/route.ts`,
  `src/app/layout.tsx`, `src/app/documents/page.tsx`, `src/env.ts`, `worker.ts`
- `apps/tanstack-start` — `src/routes/api/trpc/ingest.$.ts`,
  `src/components/persisted-feature-providers.tsx`,
  `src/components/admin/admin-dashboard.tsx`, `src/env.ts`, `worker.ts`
- `apps/tanstack-slim` — `src/routes/api/trpc/ingest.$.ts`,
  `src/routes/documents.tsx`, `src/env.ts`, `worker.ts`

## Glue

### 1. The route — `apps/nextjs/src/app/api/trpc/ingest/[trpc]/route.ts`

```ts
import { appRouter, createTRPCContext } from '@acme/ingest/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/ingest',
  router: appRouter,
  createContext: createTRPCContext,
});
```

The procedures are `adminProcedure` — they gate on the principal's `role`. An app
with no auth must inject a principal that carries one, which is why the slim
apps' constant session is `{ id: 'local', role: 'admin' }` rather than a bare id.

GET is needed: the progress tail is a subscription over the same handler.

### 2. The client provider — `apps/nextjs/src/components/pages/layout/persisted-feature-providers.tsx`

```tsx
import { clearIngestPersistedCache, IngestTRPCProvider } from '@acme/ingest';

<IngestTRPCProvider scopeKey={scopeKey}>…</IngestTRPCProvider>;
```

Server-resolved `scopeKey`, no QueryClient of its own (ADR 0036), and
`clearIngestPersistedCache` composed into the app's single logout clear.

### 3. The documents page — `apps/nextjs-slim/src/app/documents/page.tsx`

```tsx
'use client';

import {
  DocumentsList,
  IngestProgress,
  IngestUploadProvider,
  UploadDocumentsButton,
} from '@acme/ingest';

function DocumentsPage() {
  return (
    <div className="bg-background min-h-screen flex-grow space-y-6 p-5">
      <IngestUploadProvider>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Documents</h1>
          <UploadDocumentsButton />
        </div>
        <IngestProgress />
        <DocumentsList />
      </IngestUploadProvider>
    </div>
  );
}
export default DocumentsPage;
```

`IngestUploadProvider` must wrap all three components — it holds the in-flight
upload state they share. `apps/tanstack-slim/src/routes/documents.tsx` is the same
tree inside a `createFileRoute`.

The full apps compose these into an app-owned `AdminDashboard` that fuses
document management with user management and Stripe testing; the slim apps render
the feature's own UI directly. Same components, two assemblies — the shell is
app-owned (ADR 0011).

### 4. The worker — `apps/nextjs/worker.ts`

```ts
import { createIngestProcessor } from '@acme/ingest/server';
import { createWorker, QUEUE_NAMES } from '@acme/queue';

// The ingest processor takes no args — it direct-imports its own progress writer
// + the shared `publish`, and neither refunds nor reads entitlements. Second
// worker in the same process = zero new processes (rides this app's env/prefix).
const ingestWorker = createWorker(QUEUE_NAMES.INGEST, createIngestProcessor());
```

No entitlements argument, unlike chat's processor. It runs files under a
`p-limit` fan-out of `INGEST_CONCURRENCY`, downloading each **inside** its slot,
so peak memory is bounded to that many files rather than the whole batch.

Include it in the app's shutdown drain:

```ts
await Promise.all([worker.close(), ingestWorker.close()]);
```

### 5. Completion notifications

The worker publishes one `ingest.job-complete` notification per job through
`@acme/notifications`. If the app has not mounted `NotificationsProvider` and a
`ToastContainer`, ingest still works and the completion toast never appears — see
`@acme/notifications`'s `ADAPTER.md`.

### 6. Compose the env — `apps/nextjs/src/env.ts`

```ts
import { ingestEnv } from '@acme/ingest/env';

export const env = createEnv({
  extends: [chatEnv(), ingestEnv(), billingEnv(), betterAuthEnv()],
  …
});
```

This one **must** be composed — the slice carries real AWS credentials, and
composition is what makes them demanded on a real target.

## Env

Factory: `src/env.ts`, exported as `@acme/ingest/env` (`ingestEnv()`).

| Key                           | Kind            | Authored development value                                                                                               |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `AWS_REGION`                  | config          | `eu-west-2`                                                                                                              |
| `S3_ENDPOINT`                 | config          | `http://localhost:4566` (LocalStack); **authored empty** on staging/production, which selects the SDK's default AWS host |
| `S3_UPLOAD_BUCKET`            | config          | `upload-temp-bucket`                                                                                                     |
| `INGEST_PROGRESS_TTL_SECONDS` | config          | `3600` — rolling, refreshed per stage transition                                                                         |
| `INGEST_PROGRESS_POLL_MIN_MS` | config          | `100`                                                                                                                    |
| `INGEST_PROGRESS_POLL_MAX_MS` | config          | `1000`                                                                                                                   |
| `INGEST_CONCURRENCY`          | config          | `4` — worker fan-out width                                                                                               |
| `QUEUE_REMOVE_ON_COMPLETE`    | config          | `1000`                                                                                                                   |
| `QUEUE_REMOVE_ON_FAIL`        | config          | `1000`                                                                                                                   |
| `AWS_ACCESS_KEY_ID`           | config → secret | `test` in development (LocalStack accepts anything); **unauthored** on staging/production                                |
| `AWS_SECRET_ACCESS_KEY`       | config → secret | `test` in development; unauthored on staging/production                                                                  |
| `NEXT_PUBLIC_WEBAPP`          | selector        | per-app schema + Redis prefix                                                                                            |
| `NODE_ENV`                    | selector        | shared                                                                                                                   |

Three of these are worth reading twice before deploying:

- `S3_ENDPOINT` is authored `''` in the staging/production overlays rather than
  inherited — inheriting development's LocalStack URL would point a real deploy at
  localhost.
- The AWS credentials are unauthored on real targets for the same class of reason:
  inheriting `test` would fail on the first S3 call instead of at boot.
- `@acme/models` declares the **same** AWS pair (as pure secrets, for Bedrock).
  One variable, one value per process. They agree on staging/production (both
  unauthored) and can only diverge in development with Bedrock selected.

`MAX_FILE_SIZE_BYTES` and `ACCEPTED_EXTENSIONS` stay code constants in
`lib/upload-validation.ts` — env-invariant validation limits read in a
client-safe barrel.

## Infra

`acme.infra: ["localstack"]` → the `localstack` profile in `deploy/compose.yaml`
(`localstack/localstack:3.8.1`, published on `4566`, `SERVICES=s3,secretsmanager`).
`deploy/localstack-init.sh` runs on ready and creates the upload bucket.

Redis and Postgres arrive transitively (the progress stream, BullMQ, and
`@acme/rag`'s knowledge base), so `pnpm infra:up` starts all three.

## Also mount

`@acme/trpc` (the route seam), `@acme/queue` (the worker), `@acme/rag` (where
uploads are indexed), `@acme/notifications` (completion toasts), `@acme/hooks`,
`@acme/ui`, `@acme/redis`, `@acme/logger`, `@acme/env`.
