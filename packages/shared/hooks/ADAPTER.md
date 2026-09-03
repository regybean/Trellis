# Mounting `@acme/hooks`

The client-side data-fetching substrate features are built on. Features import
it directly; what your app owns is the single `QueryClient` above them and the
auth status they read
([ADR 0036](../../../docs/adr/0036-one-app-owned-query-client.md)).

## What it gives you

- `createFeatureClient` — the tRPC-plus-query client factory each feature's
  provider is built from, so every feature caches and invalidates the same way.
- An offline-read persister, per query rather than per client, so a page of
  cached results survives a reload without stale writes being replayed
  ([ADR 0025](docs/adr/0001-per-query-indexeddb-persister.md)).
- `useAuthStatus` — the auth seam features and shared UI read, so neither
  imports your auth provider.
- `useClearCacheOnLogout` — the hook that empties persisted caches when a
  session ends.
- A generic error handler, so an unhandled procedure error surfaces as a toast
  rather than a blank screen.

## Surface

| Import        | What's in it                                    | Runs   |
| ------------- | ----------------------------------------------- | ------ |
| `@acme/hooks` | Client factory, persister, auth and error hooks | client |

## Wiring

- Mount exactly one `QueryClient` above every feature provider. One per feature
  splits the cache, and then an invalidation from one feature cannot reach
  another's queries — [provider.md](../../../docs/mounting/provider.md).
- Supply the auth status. Your app knows whether someone is signed in; features
  read it through the seam.
- Pass a server-resolved user id as each persisting feature's `scopeKey`. A
  client-side session read resolves after the feature has built its persister,
  and the feature then attaches none.
- Call the clear-on-logout hook once for your whole app, with every mounted
  feature's clear function.
