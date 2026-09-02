'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';
import {
  createQueryClient,
  FEEDBACK_PERSIST_MAX_AGE,
  FEEDBACK_PERSIST_VERSION,
} from './query-client';

// Feedback's client half, assembled from the shared factory (`@acme/hooks`). The
// scaffold lives once in the factory; feedback's variation is its router type,
// endpoint (`rq-feedback` / `/api/trpc/feedback`), the batch-stream transport (no
// subscription, no file uploads), and the 24-hour per-query persister (ADR 0025).
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'feedback',
  nodeEnv: env.NODE_ENV,
  createQueryClient,
  transport: 'batch-stream',
  persister: {
    appVersion: FEEDBACK_PERSIST_VERSION,
    maxAge: FEEDBACK_PERSIST_MAX_AGE,
  },
});

// One binding at a time, NOT `export const { … } = client` — see chat's note:
// a `'use client'` module's exports must be statically named or Next's
// client-reference manifest misses them and the provider resolves to undefined.
export const TRPCReactProvider = client.TRPCReactProvider;
export const useTRPC = client.useTRPC;

/**
 * Feedback's `forMessage` query must run on *feedback's* QueryClient (the
 * persister-bearing one), not the nearest `QueryClientProvider` in context —
 * apps nest several feature providers, so it would otherwise silently never
 * persist (#82). The hook reads this and passes it explicitly to `useQuery`.
 */
export const useFeedbackQueryClient = client.useFeatureQueryClient;

/**
 * Empty the feedback feature's persisted cache (`rq-feedback`). App-driven: the
 * full apps call this — alongside `queryClient.clear()` — on the logout path so
 * a shared machine never leaks one user's Rating state to the next. Slim
 * apps have no logout and never call it. Safe no-op if storage is unavailable.
 */
export const clearPersistedCache = client.clearPersistedCache;
