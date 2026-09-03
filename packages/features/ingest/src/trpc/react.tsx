'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';

// Offline read of the Documents pane (@acme/hooks ADR 0001). The documents page is a surface
// operators revisit constantly and it cold-opens to skeletons for every query, so
// a restored `documents.list` renders instantly. 24 hours — the indexed knowledge
// base is admin-scoped content that churns on every upload/delete, so a snapshot
// is worth a day, not chat's week. Also the `gcTime` of every persisted ingest
// query, so an in-memory entry is never garbage-collected before its stored copy
// expires.
const INGEST_PERSIST_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// Data-shape version composed into the persister `buster`
// (`INGEST_PERSIST_VERSION:scopeKey`). Pinned here rather than read from
// `NEXT_PUBLIC_APP_VERSION` (chat's choice) because what invalidates an ingest
// snapshot is a change to the `documents.list` row shape, not every deploy —
// mirrors feedback. Bump it whenever that shape changes.
const INGEST_PERSIST_VERSION = '1';

// Ingest's client half, assembled from the shared factory (`@acme/hooks`). The
// scaffold lives once in the factory; ingest's variation is its router type,
// endpoint (`rq-ingest` / `/api/trpc/ingest`), the file-upload-aware transport,
// its progress `stream` subscription, and the 24-hour per-query persister
// (@acme/hooks ADR 0001) that paints the documents page from cache on a cold open. The app
// owns the `QueryClient` (ADR 0036), so there is none to configure.
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'ingest',
  nodeEnv: env.NODE_ENV,
  transport: 'blob-batch-stream',
  subscriptions: true,
  persister: {
    appVersion: INGEST_PERSIST_VERSION,
    maxAge: INGEST_PERSIST_MAX_AGE,
  },
});

// One binding at a time, NOT `export const { … } = client` — see chat's note:
// a `'use client'` module's exports must be statically named or Next's
// client-reference manifest misses them and the provider resolves to undefined.
export const TRPCProvider = client.FeatureTRPCProvider;
export const useTRPC = client.useTRPC;

/**
 * Cache policy for `documents.list`, the one query ingest persists, to spread
 * into its options (ADR 0036). Carries the persister, `gcTime`, the `persistMeta`
 * mark, and the `staleTime: 0` without which uploading a Document and reloading
 * would paint the pre-upload list. `documents.progressSnapshot` is deliberately
 * left off it — see `use-document-upload.ts`.
 */
export const usePersistedQueryOptions = client.usePersistedQueryOptions;

/**
 * Empty ingest's persisted cache (`rq-ingest`). App-driven: the full apps call
 * this — alongside `queryClient.clear()` — on the logout path so a shared
 * machine never leaks one user's Documents to the next; slim apps have no logout
 * and never call it. Safe no-op degradation on storage failure.
 */
export const clearIngestPersistedCache = client.clearPersistedCache;
