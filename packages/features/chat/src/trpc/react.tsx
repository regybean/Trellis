'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';

// Offline read of Conversation History + Messages: history is worth keeping for
// a week, so a restored `chat.list`/`chat.get` renders instantly on cold open
// (ADR 0025). Also the `gcTime` of every persisted chat query, so an in-memory
// entry is never garbage-collected before its stored copy expires.
const CHAT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// Chat's client half, assembled from the shared factory (`@acme/hooks`). All the
// scaffold — the `NODE_ENV==='test'` `httpLink` MSW seam (ADR 0018), the provider
// tree, the persister wiring — lives once in the factory; only chat's genuine
// variation is spelled out here: its router type, endpoint (`rq-chat` /
// `/api/trpc/chat`), the file-upload-aware transport, its `stream` subscription,
// and the 7-day per-query persister (ADR 0025). The app owns the `QueryClient`
// (ADR 0036), so there is none to configure.
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'chat',
  nodeEnv: env.NODE_ENV,
  transport: 'blob-batch-stream',
  subscriptions: true,
  persister: {
    appVersion: env.NEXT_PUBLIC_APP_VERSION,
    maxAge: CHAT_MAX_AGE,
  },
});

// Re-exported one binding at a time, NOT as `export const { … } = client`.
// These modules are `'use client'` boundaries: Next's client-reference manifest
// is built from statically-named export declarations, and a destructuring
// pattern isn't one — the provider silently resolves to `undefined` in an app
// build ("Element type is invalid" when prerendering). Keep the explicit form.
export const TRPCProvider = client.FeatureTRPCProvider;
export const useTRPC = client.useTRPC;
export const useTRPCClient = client.useTRPCClient;

/**
 * Cache policy for chat's persisted queries — `chat.list` and `chat.get` — to
 * spread into their options (ADR 0036). Carries the persister, `gcTime`, the
 * `persistMeta` mark, and the `staleTime: 0` that keeps a restore
 * stale-while-revalidate rather than serve-stale. Chat's other queries
 * (`chat.inflightTurn`, Folders) are deliberately left off it.
 */
export const usePersistedQueryOptions = client.usePersistedQueryOptions;

/**
 * Empty chat's persisted cache (`rq-chat`). App-driven: the full apps call this
 * — alongside `queryClient.clear()` — on the logout path so a shared machine
 * never leaks one user's Conversations to the next; slim apps have no logout and
 * never call it. Safe no-op degradation on storage failure.
 */
export const clearChatPersistedCache = client.clearPersistedCache;
