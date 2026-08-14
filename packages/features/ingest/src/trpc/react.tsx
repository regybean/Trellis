'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';
import { createQueryClient } from './query-client';

// Ingest's client half, assembled from the shared factory (`@acme/hooks`). The
// scaffold lives once in the factory; ingest's variation is its router type,
// endpoint (`/api/trpc/ingest`), the file-upload-aware transport, and its
// progress `stream` subscription. No persister — ingest is network-only.
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'ingest',
  nodeEnv: env.NODE_ENV,
  createQueryClient,
  transport: 'blob-batch-stream',
  subscriptions: true,
});

// One binding at a time, NOT `export const { … } = client` — see chat's note:
// a `'use client'` module's exports must be statically named or Next's
// client-reference manifest misses them and the provider resolves to undefined.
export const TRPCReactProvider = client.TRPCReactProvider;
export const useTRPC = client.useTRPC;
