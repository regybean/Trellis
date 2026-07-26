import type { QueryPersister } from '@tanstack/react-query';
import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from '@tanstack/react-query';
import SuperJSON from 'superjson';

/**
 * Max age of a persisted feedback entry — 24h (ADR 0025). Rating state is worth
 * keeping for a day, not a week: shorter than chat's 7d because it's cheaper to
 * refetch and bounds how long this PII lives at rest. `gcTime` is pinned to the
 * same value so a restored entry is never garbage-collected before it can be
 * read (the persister requires `gcTime >= maxAge`).
 */
export const FEEDBACK_PERSIST_MAX_AGE = 24 * 60 * 60 * 1000;

/**
 * Data-shape version, composed into the persister `buster` (`appVersion:scopeKey`)
 * so a snapshot from an incompatible shape is discarded on restore rather than
 * rehydrated. Bump this whenever the persisted query's data shape changes.
 */
export const FEEDBACK_PERSIST_VERSION = 'v1';

/**
 * The feature's `QueryClient`. When an app opts persistence in (by supplying a
 * `scopeKey`, which yields a `persister`), the persister is attached and `gcTime`
 * is widened to `maxAge`; without one, behaviour is exactly as before
 * (network-only). Persistence is a pure read-time optimisation.
 */
export const createQueryClient = (persister?: QueryPersister) =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
        ...(persister ? { persister, gcTime: FEEDBACK_PERSIST_MAX_AGE } : {}),
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
