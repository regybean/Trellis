# `documents.list` is the only persisted query

**Status:** accepted — ticket #216

## Context

Operators revisit the documents page constantly, and every visit cold-opened to
skeletons while `documents.list` round-tripped. The shared per-query IndexedDB
persister exists for exactly this
([@acme/hooks ADR 0001](../../../../shared/hooks/docs/adr/0001-per-query-indexeddb-persister.md)),
and the app owns the single `QueryClient`
([ADR 0036](../../../../../docs/adr/0036-one-app-owned-query-client.md)), so
opting in is per query rather than client-wide.

Ingest has two queries, and only one of them wants this. The other,
`documents.progressSnapshot`, is in-flight Upload state.

## Decision

**Opt in per query, and only `documents.list` opts in.** `useDocuments` spreads
`usePersistedQueryOptions()` into that query's options. It is the query that buys
the paint: the indexed knowledge base is the page's content.

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
deploy; ingest should not. What invalidates an ingest snapshot is a change to the
`documents.list` row shape, so the version is bumped when that shape changes.
`maxAge` is 24 hours, carried as the persisted query's `gcTime` so an in-memory
entry is never collected before its stored copy expires — the knowledge base
churns on every upload and delete, so a snapshot is worth a day, not chat's week.

**`clearIngestPersistedCache()` is exported for the app's logout path.** Full apps
call it alongside `queryClient.clear()` so a shared machine never leaks one
operator's Documents to the next; the slim apps have no logout and never call it.

**`staleTime: 0` on `documents.list` is part of this decision, not a default left
at zero.** It replaced a client-wide 30s value and now rides on the query, in the
same spread as the persister.

## Consequences

- **Positive.** The documents page paints from cache on a cold open instead of
  showing skeletons, without the progress panel inheriting a cache it must not
  have.
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
- **Bumping the version is manual.** Change the `documents.list` row shape without
  bumping `INGEST_PERSIST_VERSION` and operators paint a stale shape from
  IndexedDB for up to 24 hours.
- **An operator's document list sits on disk for a day.** Admin-scoped content in
  browser storage, cleared on logout only where a logout exists.
