'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';
import {
  createQueryClient,
  INGEST_PERSIST_MAX_AGE,
  INGEST_PERSIST_VERSION,
} from './query-client';

// Ingest's client half, assembled from the shared factory (`@acme/hooks`). The
// scaffold lives once in the factory; ingest's variation is its router type,
// endpoint (`rq-ingest` / `/api/trpc/ingest`), the file-upload-aware transport,
// its progress `stream` subscription, and the 24-hour per-query persister
// (ADR 0025) that paints the documents page from cache on a cold open.
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'ingest',
  nodeEnv: env.NODE_ENV,
  createQueryClient,
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
export const TRPCReactProvider = client.TRPCReactProvider;
export const useTRPC = client.useTRPC;

/**
 * Ingest's queries must run on *ingest's* QueryClient (the persister-bearing
 * one), not the nearest `QueryClientProvider` in context — apps nest several
 * feature providers, so `useQueryClient()` resolves whichever is innermost and
 * `documents.list` would silently never persist (#82). Hooks read this and pass
 * it explicitly to `useQuery`.
 */
export const useIngestQueryClient = client.useFeatureQueryClient;

/**
 * Empty ingest's persisted cache (`rq-ingest`). App-driven: the full apps call
 * this — alongside `queryClient.clear()` — on the logout path so a shared
 * machine never leaks one user's Documents to the next; slim apps have no logout
 * and never call it. Safe no-op degradation on storage failure.
 */
export const clearIngestPersistedCache = client.clearPersistedCache;
