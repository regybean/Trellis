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
        // `staleTime: 0` is load-bearing for the persister, NOT a default we
        // left at zero. On a cold open the persister (`experimental_createQuery-
        // Persister`) *is* the queryFn: it restores the snapshot and returns it,
        // then schedules a background refetch only `if (query.isStale())`. That
        // staleness check reads `staleTime` — it does NOT honour `refetchOnMount`
        // (the observer's mount-fetch is fully consumed by the persister handing
        // back cached data; there is no second, independent network hit). So with
        // any `staleTime > 0` a snapshot younger than it is served WITHOUT
        // revalidating. That is the refresh bug: chat's caches are also written
        // optimistically via `setQueryData` (the streamed Messages in `chat.get`;
        // the "New chat" row in `chat.list`) with a *recent* `dataUpdatedAt` but
        // stale content — a first-Turn `chat.get` persisted as `[]`, a `chat.list`
        // from before the new thread — so a quick refresh restored a stale-but-
        // "fresh" snapshot and never refetched: blank pane, sidebar missing the
        // new thread. `staleTime: 0` makes every restored entry stale, so the
        // persister always fires the background refetch — instant paint (ADR 0025)
        // preserved, server truth always revalidated. The in-flight Stream is
        // unaffected: `useChat`'s `onStarted` cancels the `chat.get` fetch and
        // `refreshHistoryPrefix` supplies the prefix via the vanilla client.
        staleTime: 0,
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
