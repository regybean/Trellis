import type { QueryPersister } from '@tanstack/react-query';
import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from '@tanstack/react-query';
import SuperJSON from 'superjson';

// Offline read of the Documents pane (ADR 0025). The documents page is a surface
// operators revisit constantly and it cold-opens to skeletons for every query, so
// a restored `documents.list` renders instantly. 24 hours — the indexed knowledge
// base is admin-scoped content that churns on every upload/delete, so a snapshot
// is worth a day, not chat's week. `gcTime >= maxAge` so an in-memory query isn't
// garbage-collected before its persisted copy expires.
export const INGEST_PERSIST_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// Data-shape version composed into the persister `buster`
// (`INGEST_PERSIST_VERSION:scopeKey`). Pinned here rather than read from
// `NEXT_PUBLIC_APP_VERSION` (chat's choice) because what invalidates an ingest
// snapshot is a change to the `documents.list` row shape, not every deploy —
// mirrors feedback. Bump it whenever that shape changes.
export const INGEST_PERSIST_VERSION = '1';

// `persister` is supplied only in the browser and only when the app passes a
// `scopeKey` (see trpc/react). Absent ⇒ network-only, exactly as before —
// persistence is a pure optimisation, never a hard dependency.
export const createQueryClient = (persister?: QueryPersister) =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // `staleTime: 0` is load-bearing for the persister, NOT a default left at
        // zero (it replaced a 30s staleTime when ingest opted in). On a cold open
        // the persister (`experimental_createQueryPersister`) *is* the queryFn: it
        // restores the snapshot and returns it, then schedules a background
        // refetch only `if (query.isStale())`. That staleness check reads
        // `staleTime` — it does NOT honour `refetchOnMount` (the observer's
        // mount-fetch is fully consumed by the persister handing back cached
        // data; there is no second, independent network hit). So with any
        // `staleTime > 0` a snapshot younger than it is served WITHOUT
        // revalidating. On the documents page that means uploading a Document and
        // reloading straight into the pre-upload list. `staleTime: 0` makes every
        // restored entry stale, so the persister always fires the background
        // refetch — instant paint (ADR 0025) preserved, server truth always
        // revalidated.
        staleTime: 0,
        ...(persister ? { persister, gcTime: INGEST_PERSIST_MAX_AGE } : {}),
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
