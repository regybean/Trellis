import type { QueryPersister } from '@tanstack/react-query';
import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from '@tanstack/react-query';
import SuperJSON from 'superjson';

// Offline read of Conversation History + Messages: history is worth keeping for
// a week, so a restored `chat.list`/`chat.get` renders instantly on cold open
// (ADR 0025). `gcTime >= maxAge` so an in-memory query isn't garbage-collected
// before its persisted copy expires.
export const CHAT_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// `persister` is supplied only in the browser and only when the app passes a
// `scopeKey` (see trpc/react). Absent ⇒ network-only, exactly as before —
// persistence is a pure optimisation, never a hard dependency.
export const createQueryClient = (persister?: QueryPersister) =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
        // Always revalidate on a cold open (page refresh / conversation
        // switch). The persister restores only the last *successful fetch*, but
        // chat's caches (`chat.get`, `chat.list`) are also written optimistically
        // via `setQueryData` — the streamed Messages and the "New chat" sidebar
        // row — and those writes never reach the persisted snapshot. So the
        // restored snapshot lags reality (a first-Turn Conversation persists the
        // empty greeting `[]`; the sidebar persists the list *before* the new
        // thread). Under `staleTime` alone that stale-but-recent snapshot is
        // served without revalidating, leaving the message pane blank or the new
        // thread missing from the sidebar on refresh. `refetchOnMount: 'always'`
        // keeps the instant paint (ADR 0025) while refetching server truth in
        // the background on every mount. The in-flight Stream is unaffected —
        // `useChat`'s `onStarted` cancels the `chat.get` fetch and
        // `refreshHistoryPrefix` supplies the prefix via the vanilla client.
        refetchOnMount: 'always',
        ...(persister ? { persister, gcTime: CHAT_MAX_AGE } : {}),
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === 'pending',
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
