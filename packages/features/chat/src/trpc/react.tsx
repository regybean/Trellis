'use client';

import { createFeatureClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { env } from '../env';
import { CHAT_MAX_AGE, createQueryClient } from './query-client';

// Chat's client half, assembled from the shared factory (`@acme/hooks`). All the
// scaffold — the SSR `getQueryClient` singleton, the `NODE_ENV==='test'`
// `httpLink` MSW seam (ADR 0018), the provider tree — lives once in the factory;
// only chat's genuine variation is spelled out here: its router type, endpoint
// (`rq-chat` / `/api/trpc/chat`), the file-upload-aware transport, its `stream`
// subscription, and the 7-day per-query persister (ADR 0025).
const client = createFeatureClient<AppRouter>({
  keyPrefix: 'chat',
  nodeEnv: env.NODE_ENV,
  createQueryClient,
  transport: 'blob-batch-stream',
  subscriptions: true,
  persister: {
    appVersion: env.NEXT_PUBLIC_APP_VERSION,
    maxAge: CHAT_MAX_AGE,
  },
});

export const TRPCReactProvider = client.TRPCReactProvider;
export const useTRPC = client.useTRPC;
export const useTRPCClient = client.useTRPCClient;

/**
 * Chat's queries must run on *chat's* QueryClient (the persister-bearing one),
 * not the nearest `QueryClientProvider` in context — apps nest several feature
 * providers, so `useQueryClient()` would resolve whichever is innermost and
 * chat's queries would silently never persist (#82). Hooks read this and pass it
 * explicitly to `useQuery`.
 */
export const useChatQueryClient = client.useFeatureQueryClient;

/**
 * Empty chat's persisted cache (`rq-chat`). App-driven: the full apps call this
 * — alongside `queryClient.clear()` — on the Clerk logout path so a shared
 * machine never leaks one user's Conversations to the next; slim apps have no
 * logout and never call it. Safe no-op degradation on storage failure.
 */
export const clearChatPersistedCache = client.clearPersistedCache;
