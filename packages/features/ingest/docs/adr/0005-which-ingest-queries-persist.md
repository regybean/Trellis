# Which ingest queries persist

**Status:** accepted

## Context

Users revisit the documents page constantly, and every visit cold-opened to
skeletons while `documents.list` round-tripped. The shared per-query IndexedDB
persister exists for exactly this, and the app owns the single `QueryClient`, so
opting in is per query rather than client-wide.

Ingest has four queries and only two of them want this. Of the other two,
`documents.progressSnapshot` is in-flight Upload state and `dataSources.limits`
is two integers behind one round trip.

## Decision

**Opt in per query. `documents.list` and `dataSources.list` opt in; the other
two do not.** `useDocuments` and `useDataSources` spread
`usePersistedQueryOptions()` into those queries' options. They are the two that
buy the paint: the indexed knowledge base is the page's content, and the rail is
the frame the whole page hangs off, so restoring both is what keeps a cold open
from painting an empty rail beside a populated detail pane.

**Persisting the rail is safe because the rail is a management surface only.** No
privacy decision reads a Data Source name from it — the chat-side tooltip and
"Sources included" read the per-Message record — so a ghost row in a stale rail
is cosmetic, and the rail's own counts come from `documents.list` rather than
from the persisted row.

**`dataSources.limits` is deliberately excluded.** It is two integers behind one
round trip, and persisting it would put a retunable cap on disk for a day for no
paint worth having. It is also the one query whose value is meant to move under
the client: the caps are rag's env.

**`documents.progressSnapshot` is deliberately excluded.** Its whole point is to
be read fresh from the retained stream. A persisted copy would re-seed the
progress panel with Uploads that finished hours ago, behind a `lastId` the stream
has since expired past — reintroducing by cache the exact stale-progress problem
the snapshot exists to solve
([ADR 0001](0001-ingest-progress-survives-refresh.md)).

**`IngestTRPCProvider` takes an app-supplied `scopeKey`, and without one ingest
is network-only.** Present, it gates the persister and composes the cache
`buster`; absent — or with IndexedDB unavailable — behaviour is exactly as it was
before persistence existed. Ingest keeps its own store, `rq-ingest`, and its keys
live in the app's one `QueryClient` under the `ingest` key prefix.

**`buster` is `INGEST_PERSIST_VERSION:scopeKey`, and the version is pinned in
`trpc/react.tsx` — not read from `NEXT_PUBLIC_APP_VERSION`.** Chat busts on every
deploy; ingest should not. What invalidates an ingest snapshot is a change to a
persisted row shape — `documents.list`'s or `dataSources.list`'s — so the version
is bumped when either changes.
`maxAge` is 24 hours, carried as the persisted query's `gcTime` so an in-memory
entry is never collected before its stored copy expires — the knowledge base
churns on every upload and delete, so a snapshot is worth a day, not chat's week.

**`clearIngestPersistedCache()` is exported for the app's logout path.** Full apps
call it alongside `queryClient.clear()` so a shared machine never leaks one
user's Documents to the next; the slim apps have no logout and never call it.

**`staleTime: 0` is part of this decision, not a default left at zero.** It
replaced a client-wide 30s value and now rides on both persisted queries, in the
same spread as the persister.

## Consequences

- **Positive.** The documents page paints its rail AND its list from cache on a
  cold open instead of showing skeletons, without the progress panel inheriting
  a cache it must not have.
- **`staleTime: 0` is load-bearing and silently so.** On a cold open the persister
  _is_ the queryFn: it restores the snapshot, returns it, and only then schedules
  a background refetch `if (query.isStale())` — a check that reads `staleTime` and
  ignores `refetchOnMount`. Any `staleTime > 0` therefore serves a restored
  snapshot **without revalidating**, which on this surface means uploading a
  Document, reloading, and being shown the pre-upload list.
- **That always-firing refetch is also what makes the persister's floating
  `query.fetch()` reachable**, so ingest depends on the pinned
  `pnpm patch` (`patches/@tanstack__query-persist-client-core@5.90.2.patch`) that
  swallows a failed background revalidation. The offline case in
  `use-documents-persistence.test.tsx` fails the run as an unhandled rejection if
  that patch ever stops applying — which is the intended alarm.
- **Bumping the version is manual, and it now guards two shapes.** Change either
  persisted row shape without bumping `INGEST_PERSIST_VERSION` and users paint a
  stale shape from IndexedDB for up to 24 hours.
- **A user's document list and Data Source names sit on disk for a day.** Their
  own content in their own browser storage, cleared on logout only where a logout
  exists.
