# Recipe: the provider tree

A feature's hooks need two things in React context: a tRPC client pointed at the
path you mounted its router on, and a TanStack Query `QueryClient`. Each feature
package exports a provider that supplies the first. The second is yours, and
there is exactly one of it.

## 1. One QueryClient, owned by your app

Mount a single `QueryClient` above every feature provider
([ADR 0036](../adr/0036-one-app-owned-query-client.md)). Feature providers do
not create their own — stacking clients per feature splits the cache, so an
invalidation from one feature cannot reach a query another feature owns.

```tsx
<QueryClientProvider client={queryClient}>
  {/* feature providers nest below */}
</QueryClientProvider>
```

Where this goes depends on your framework: a root layout, a router context, or
whatever runs above all routes.

## 2. Feature providers

Each feature exports a provider from its `.` (client) subpath. Nest them in any
order — they contribute tRPC context only, so the nesting carries no meaning.

```tsx
<ChatTRPCProvider scopeKey={userId}>
  <FeedbackTRPCProvider scopeKey={userId}>{children}</FeedbackTRPCProvider>
</ChatTRPCProvider>
```

The provider must be able to reach the path you mounted the feature's router on
in [trpc-route.md](trpc-route.md).

## 3. `scopeKey` — the persistence seam

Features that persist reads offline take a `scopeKey`
([@acme/hooks ADR 0001](../../packages/shared/hooks/docs/adr/0001-per-query-indexeddb-persister.md)). It scopes the cached
snapshot, so a different user, or a deploy that changes the data shape, discards
the previous one.

Your app owns what goes in it, because your app owns auth. Features stay
auth-agnostic: the value arrives as a plain string.

- Pass the signed-in user's id, resolved **on the server** so it is present on
  the first render. A client-side session read resolves after the feature has
  already built its persister, and the feature silently attaches none.
- Pass nothing when signed out. The feature falls back to network-only.

## 4. Clearing on logout

Persisted caches outlive a session, so they have to be cleared when one ends.
Each feature that persists exports a clear function; call them together from one
place in your app rather than per feature.

```ts
await Promise.all([clearChatPersistedCache(), clearFeedbackPersistedCache()]);
```

`@acme/hooks` supplies the auth-status and clear-on-logout hooks this hangs off.

## 5. Server-rendered pages

A feature's provider is client-side. If your framework renders pages on the
server, the provider has to sit inside a client boundary — a `'use client'`
module in Next.js, or the equivalent in yours — with server-resolved values like
`scopeKey` passed in as props.
