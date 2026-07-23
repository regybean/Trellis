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
