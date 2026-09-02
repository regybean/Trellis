'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';

/**
 * Max age of a persisted feedback entry — 24h (ADR 0025). Rating state is worth
 * keeping for a day, not a week: shorter than chat's 7d because it's cheaper to
 * refetch and bounds how long this PII lives at rest. It is also the `gcTime`
 * every persisted feedback query gets, so a restored entry is never
 * garbage-collected before it can be read.
 */
const FEEDBACK_PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * Data-shape version, composed into the persister `buster` (`appVersion:scopeKey`)
 * so a snapshot from an incompatible shape is discarded on restore rather than
 * rehydrated. Bump this whenever the persisted query's data shape changes.
 */
const FEEDBACK_PERSIST_VERSION = 'v1';

// Feedback's client half, assembled from the shared factory (`@acme/hooks`). The
// scaffold lives once in the factory; feedback's variation is its router type,
// endpoint (`rq-feedback` / `/api/trpc/feedback`), the batch-stream transport (no
// subscription, no file uploads), and the 24-hour per-query persister (ADR 0025).
// The app owns the `QueryClient` (ADR 0036), so there is none to configure.
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'feedback',
  nodeEnv: env.NODE_ENV,
  transport: 'batch-stream',
  persister: {
    appVersion: FEEDBACK_PERSIST_VERSION,
    maxAge: FEEDBACK_PERSIST_MAX_AGE,
  },
});

// One binding at a time, NOT `export const { … } = client` — see chat's note:
// a `'use client'` module's exports must be statically named or Next's
// client-reference manifest misses them and the provider resolves to undefined.
export const TRPCProvider = client.FeatureTRPCProvider;
export const useTRPC = client.useTRPC;

/**
 * Cache policy for `feedback.forMessage`, the one query feedback persists, to
 * spread into its options (ADR 0036). Carries the persister, `gcTime`, the
 * `persistMeta` mark, and `staleTime: 0`.
 *
 * That `staleTime` is a change: feedback used to pair the persister with a 30s
 * client default — the exact combination ADR 0025 identifies as serving a
 * restored snapshot without revalidating. It was never a live bug here (this
 * hook's mutations `invalidate` on settle rather than writing optimistically, so
 * a persisted entry is always server truth), but the window would have opened
 * the day feedback wrote optimistically, silently. Now the persister and the
 * `staleTime` that makes it correct arrive together.
 */
export const usePersistedQueryOptions = client.usePersistedQueryOptions;

/**
 * Empty the feedback feature's persisted cache (`rq-feedback`). App-driven: the
 * full apps call this — alongside `queryClient.clear()` — on the logout path so a
 * shared machine never leaks one user's Rating state to the next. Slim apps have
 * no logout and never call it. Safe no-op if storage is unavailable.
 */
export const clearPersistedCache = client.clearPersistedCache;
