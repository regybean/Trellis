# One app-owned QueryClient; cache policy declared per query

**Status:** accepted

Each feature minted its own `QueryClient` and nested its own `QueryClientProvider`
(`createFeatureClient`, `@acme/hooks`). A full app stacked four of them, so a bare
`useQuery` bound to whichever provider happened to be innermost — [#82](https://github.com/regybean/Trellis/issues/82).
The mitigation was `useFeatureQueryClient`: every hook had to remember to pass its
own client as `useQuery`'s second argument. Forget it and nothing breaks loudly —
the query still runs, it just never persists. That failure mode stays open for as
long as more than one client is in context.

## Decision

**One `QueryClient` per app, owned by the app.** Feature providers render
`TRPCProvider` only; they read the client from context (`useQueryClient`) and
render no `QueryClientProvider` of their own. There is exactly one in any app's
tree, so hooks pass no explicit client and the class of bug above cannot recur.

**Cache policy moves onto the query.** What the per-feature clients actually
carried was three defaults — `staleTime`, `persister`, `gcTime`. `persister` is a
per-query option by design (["If you provide this `persister` to a single
`useQuery` hook, only this Query will be persisted"](https://tanstack.com/query/latest/docs/framework/react/plugins/createPersister)),
and tRPC passes it through untouched (`ReservedOptions` is only
`queryKey | queryFn | queryHashFn | queryHash`). So a feature that persists
declares it where the query is declared, not on a client that has to be threaded
to the call site to take effect.

To keep that from becoming per-call-site copy-paste, `createFeatureClient`
returns a **`usePersistedQueryOptions()`** hook. It yields the whole policy for one
persisted query — `meta: persistMeta`, the feature's `persister`, `gcTime` pinned to
its `maxAge`, and `staleTime: 0` — to spread into the query's options:

```ts
const persisted = usePersistedQueryOptions();
useQuery(
  trpc.chat.get.queryOptions({ sessionId }, { retry: false, ...persisted }),
);
```

Binding `staleTime: 0` into that fragment is the point, not a detail. @acme/hooks ADR 0001
established that any `staleTime > 0` silently converts stale-while-revalidate into
serve-stale, because the persister _is_ the queryFn on a cold open and only
schedules its background refetch `if (query.isStale())`. As a client default that
coupling was two files apart and a feature could get it wrong (feedback did — see
below). Attached to the persisted-query fragment, the persister and the `staleTime`
that makes it correct arrive together or not at all.

### Isolating a slice was never this client's job

The concern a per-feature client looks like it answers — keeping a feature's
frontend and backend together and separate from its neighbours — is carried by
two other mechanisms, both of which survive a shared cache:

- **The per-feature tRPC client.** `createTRPCClient` with its own endpoint
  (`/api/trpc/<keyPrefix>`) and transport links. A different object entirely;
  untouched here.
- **`keyPrefix`.** tRPC does `key.unshift([opts.prefix])` on every key
  (`getQueryKeyInternal`), so `['chat'],['documents','list']` cannot collide with
  `['ingest'],['documents','list']` in one cache. Collision-safety is already
  solved and never depended on the client.

tRPC's own `multipleTrpcProviders.test.tsx` mounts several `TRPCProvider`s inside
**one** `QueryClientProvider` — the shared-client shape is the upstream model.

### The SSR config the feature clients carried was inert

Four of the five clients repeated an identical SuperJSON `dehydrate`/`hydrate`
block and the create-t3-app comment _"With SSR, we usually want to set some
default staleTime above 0"_. Neither was doing anything:

- No app imports `HydrateClient`, `createServerTRPC`, or `prefetch`;
  `packages/features/ingest/src/trpc/server.tsx` says as much itself.
- The TanStack apps already had an app-level `QueryClient` in `src/router.tsx`
  wired to `setupRouterSsrQueryIntegration`, and every feature provider
  **shadowed** it — so feature queries never participated in SSR hydration at all.

That block therefore moves once, into `createAppQueryClient()` in `@acme/hooks`
(SuperJSON `serializeData`/`deserializeData`, and `shouldDehydrateQuery` widened
to pending queries for streamed SSR). All four apps build their client from it;
the TanStack apps pass it to `setupRouterSsrQueryIntegration` as before. Feature
queries can now hydrate through that integration instead of being shadowed. No
route loader prefetches one today, so nothing changes at runtime — but the
serializer is in place for when one does, which is the only reason the config was
ever worth keeping.

### `staleTime`, decided per feature rather than inherited

| Feature       | Was         | Now                            | Why                                                                                                                                                                                                                                                                                                         |
| ------------- | ----------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| chat          | `0`         | `0`, via the persisted options | Unchanged and load-bearing (@acme/hooks ADR 0001).                                                                                                                                                                                                                                                          |
| ingest        | `0`         | `0`, via the persisted options | Same.                                                                                                                                                                                                                                                                                                       |
| feedback      | `30s`       | `0`, via the persisted options | It paired a persister with `staleTime: 30s` — the combination @acme/hooks ADR 0001 names as serving a restored snapshot without revalidating. See below.                                                                                                                                                    |
| billing       | `30s`       | app default (`0`)              | t3 boilerplate that was **already not in effect** — see below. `0` is also right on the merits: a 30s window only ever hides a change the user just caused (credits after a Turn, tier right after a checkout return), the reads are cheap Redis hits, and every write path already invalidates explicitly. |
| notifications | unset (`0`) | app default (`0`)              | Subscription-only — no queries for a `staleTime` to apply to.                                                                                                                                                                                                                                               |

**billing's `staleTime` had already stopped applying.** Billing was the one feature
that never pinned a client — its hooks call `useQuery` with no second argument,
because only chat, feedback and ingest got #82's mitigation. In both full apps the
innermost `QueryClientProvider` beneath billing's own was **notifications**', which
sets no `defaultOptions.queries` at all. So billing's queries have been running on
the notifications cache at `staleTime: 0`, and the 30s it declared has been dead for
as long as that provider has been mounted below it.

Nothing was visibly broken — everything in that subtree resolves to the same client,
so the queries and their invalidations agreed with each other. And no test caught it,
because the frontend suites mount billing's provider on its own, where
`useQueryClient()` genuinely does return billing's client.

That is the sharpest argument for this ADR. The old design let a feature declare
cache policy that silently did not apply, with the outcome depending on which
provider an app happened to nest last. One client per app makes the question
disappear: a query's options are the only thing deciding its behaviour.

**feedback was not a live bug, and is fixed anyway.** `use-feedback.ts` never
writes optimistically (its mutations `invalidate` on settle), so a persisted entry
was always real server truth and the stale window only opened on a reload within
30s of your own last fetch, on data only you can change. But it meant feedback
never exercised the patched floating `query.fetch()` — no coverage of the pinned
patch — and the day it adds an optimistic write it would have acquired chat's bug
in silence. `staleTime: 0` now comes with the persister rather than beside it.

### Logout clears the app, not a feature

`useClearCacheOnLogout` calls `queryClient.clear()`. With one client that empties
every feature at once, so it is rendered **once** per app rather than once inside
each feature provider, and takes a single `clearStore` the app composes from its
mounted features' `clearPersistedCache` functions. This is the right scope for
what the hook is for: a shared machine, where the departing user's chat history,
feedback, _and_ documents must all go. Previously three renders each cleared the
whole (well, their own) cache and one store.

## What this changes in @acme/hooks ADR 0001

[ADR 0025](0025-per-query-indexeddb-persister.md) is otherwise intact — per-query
persistence, IndexedDB via `idb-keyval`, per-feature `rq-<keyPrefix>` stores,
app-supplied `scopeKey`, the `buster`, the pinned patch and the `query-core`
override all stand. Three sentences in it assumed a per-feature client and are
amended in place:

- _"A feature turns it on by attaching the persister to its `QueryClient`"_ → the
  persister is attached per query, through `usePersistedQueryOptions()`.
- _"`gcTime >= maxAge` on the QueryClient"_ → `gcTime` is set on the persisted
  query, still pinned to the feature's `maxAge`.
- _"`staleTime: 0` on chat's and ingest's `QueryClient`s"_ → `staleTime: 0` is part
  of the persisted-query fragment, so it applies to exactly the queries that need
  it and cannot be separated from the persister.

### The provider is renamed, because the old name meant both

`TRPCReactProvider` (the create-t3-app name) used to render a `QueryClientProvider`
_and_ a `TRPCProvider`, so "provider" honestly covered both. It now renders only the
tRPC half, and a layout full of `*TRPCReactProvider`s reads like a stack of query
clients that this ADR claims to have deleted — the first question anyone asks on
seeing the diff.

So the factory returns `FeatureTRPCProvider`, and each package exports
`<Feature>TRPCProvider`: `ChatTRPCProvider`, `IngestTRPCProvider`,
`FeedbackTRPCProvider`, `BillingTRPCProvider`. That converges all five on the name
`@acme/notifications` already used. What each still carries is genuinely per-feature
and does not collapse: its own tRPC client and endpoint (`/api/trpc/<keyPrefix>`),
its transport links, its `keyPrefix`, and its persister scope.

## Considered and rejected

- **Keep the per-feature clients, keep pinning.** The status quo. It works only
  while every author remembers the second argument, and the failure is silent —
  a query that persists nothing looks identical to one that does until you go
  offline. Deleting the ambiguity beats documenting it.
- **One client, but feature policy as `queryClient.setQueryDefaults(keyPrefix)`.**
  Tempting — `keyPrefix` is already the namespace, so defaults could key off it.
  But it puts the feature's policy in the _app_'s client construction, which is
  the coupling this ADR exists to remove: an app would have to know that chat
  needs `staleTime: 0`, and a new app that forgot would silently break chat's
  revalidation. Policy belongs with the query.
- **Move `createFeatureClient` back to whole-client persistence so the client
  stays meaningful.** Rejected by @acme/hooks ADR 0001 on its own merits (feedback's
  one-query-per-Message write pattern), and unchanged by this decision.
- **An app-level `QueryClient` in each app with no shared factory.** Four copies
  of the same SuperJSON dehydrate block and the same browser-singleton subtlety.
  `createAppQueryClient()` / `AppQueryClientProvider` in `@acme/hooks` is one
  source of truth; apps still own _mounting_ it, which is the part that differs
  (Next root layout vs. the TanStack router's `Wrap`).

## Consequences

- `useFeatureQueryClient` is gone, and with it the per-feature
  `useChatQueryClient` / `useFeedbackQueryClient` / `useIngestQueryClient`
  re-exports. Hooks use `useQueryClient()` from `@tanstack/react-query`; there is
  only one client for it to resolve to.
- The five `trpc/query-client.ts` files are deleted. A feature's `maxAge` and
  persist `version` constants move next to its provider in `trpc/react.tsx`.
- **A feature is no longer mountable without an app-owned `QueryClientProvider`
  above it.** That is a real new requirement on apps (and on any frontend test
  setup): a feature provider on its own now throws from `useQueryClient`. The
  trade is that the failure is loud and immediate, where the old one was silent.
- `apps/billing` — the last hand-rolled feature provider — folds into
  `createFeatureClient` on the way through, since it had to lose its
  `QueryClientProvider` regardless. Its dead `splitLink` branches (a subscription
  split for a router with no subscription; a blob split for a feature that uploads
  nothing) go with it.
- Cross-feature cache operations become possible, for better and worse: an app
  can now invalidate chat's keys from a billing callback without threading a
  client. `keyPrefix` keeps them addressable and non-colliding, but nothing stops
  a feature from reaching into another's namespace — the discipline that used to
  be structural is now convention.
- One cache means one `gcTime` budget and one `clear()`. Features that persist
  still isolate at rest (`rq-<keyPrefix>`), so a logout clear still has to name
  every mounted feature's store.
