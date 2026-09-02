# Mounting `@acme/hooks`

An app mounts this as two providers plus one adapter component:

1. **one** QueryClient, above every feature provider (ADR 0036);
2. an `AuthStatusProvider` fed by whatever auth the app has — the app writes the
   mapping, so features never learn which provider is mounted (ADR 0003);
3. a single `useClearCacheOnLogout` call, composed over every persisted store the
   app mounts.

## Mounted by

All four apps:

- `apps/nextjs` — `src/app/layout.tsx`, `src/components/pages/layout/better-auth-status.tsx`,
  `src/components/pages/layout/persisted-feature-providers.tsx`
- `apps/nextjs-slim` — `src/app/layout.tsx`
- `apps/tanstack-start` — `src/router.tsx`, `src/components/better-auth-status.tsx`,
  `src/components/persisted-feature-providers.tsx`
- `apps/tanstack-slim` — `src/router.tsx`

## Glue

### 1a. The one QueryClient, Next.js — `apps/nextjs/src/app/layout.tsx`

```tsx
import { AppQueryClientProvider } from '@acme/hooks';

{/* The app's one QueryClient (ADR 0036). It sits above every
    feature provider because those render none of their own —
    their queries all live in this cache, namespaced by tRPC's
    keyPrefix. */}
<AppQueryClientProvider>
  <BillingTRPCProvider>
    <PersistedFeatureProviders scopeKey={userId ?? undefined}>
      …
```

### 1b. The one QueryClient, TanStack Start — `apps/tanstack-start/src/router.tsx`

```tsx
import { createAppQueryClient } from '@acme/hooks';

export function getRouter() {
  const queryClient = createAppQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}
```

Two entry points for the same client: the component for a React tree, the factory
where the framework owns creation (here so the same instance feeds the SSR query
integration).

Order matters. Feature `TRPCProvider`s render no client of their own, so this one
must sit **above** them — and nothing may nest a second QueryClient below it, or
feature queries end up in a cache that never participates in SSR hydration.

### 2. The auth seam — `apps/nextjs/src/components/pages/layout/better-auth-status.tsx`

```tsx
'use client';

import { AuthStatusProvider, resolvedAuthStatus } from '@acme/hooks';

import { authClient } from '~/lib/auth-client';

export function BetterAuthStatusProvider({
  initialUserId,
  children,
}: {
  initialUserId: string | null;
  children: ReactNode;
}) {
  const { data, isPending } = authClient.useSession();

  // Until the client's own fetch resolves, the server-resolved session is the
  // better answer; after it resolves it is the authoritative one (it reflects a
  // sign-out that happened in this tab).
  const status = isPending
    ? resolvedAuthStatus(initialUserId)
    : resolvedAuthStatus(data?.user.id ?? null);

  return <AuthStatusProvider status={status}>{children}</AuthStatusProvider>;
}
```

This mapping is **duplicated** in `apps/tanstack-start` rather than shared, and
that is the seam working as designed: `authClient` is app-owned, and a shared
component would pull `better-auth` into the substrate — which the slim, no-auth
apps must never see (ADR 0010).

`initialUserId` is seeded from a server-resolved session, so `isLoaded` is true on
the first render and a viewer-scoped query fires immediately rather than on the
second pass. The slim apps mount no `AuthStatusProvider` at all — hence
`useOptionalAuthStatus` for consumers that must work either way.

### 3. Clear the cache on logout — `apps/nextjs/src/components/pages/layout/persisted-feature-providers.tsx`

```tsx
const clearPersistedStores = async () => {
  await Promise.all([
    clearChatPersistedCache(),
    clearFeedbackPersistedCache(),
    clearIngestPersistedCache(),
  ]);
};

function ClearCacheOnLogout() {
  const { isSignedIn } = useAuthStatus();
  useClearCacheOnLogout(isSignedIn, clearPersistedStores);
  return null;
}
```

Rendered **once**, not once per feature provider: the hook pairs
`queryClient.clear()` with the store clear, and with one app-owned client
`clear()` already empties every feature. `clearPersistedStores` is module-level so
its identity is stable across renders (it feeds an effect's deps).

The TanStack app derives `isSignedIn` from `scopeKey` instead of an auth hook, so
the signal the hook watches and the scope the cache is stored under cannot
disagree.

### 4. What features use, not apps

`createFeatureClient`, `createQueryPersister`, `clearPersistedCache` and
`persistMeta` are the pieces a **feature** package uses to build its
`TRPCProvider` and its per-feature IndexedDB persister (ADR 0025). An app calls
none of them directly — it passes `scopeKey` to the feature provider and gets a
`clear*PersistedCache` function back to compose above.

## Env

Factory: none. `@acme/hooks` reads no environment.

## Infra

None — no `acme.infra`. Persistence is IndexedDB in the browser (`idb-keyval`),
so there is no server-side store to provision.

## Also mount

Nothing from `@acme/*` — this package has no `@acme` dependencies, which is what
lets the slim apps mount it without pulling auth or billing in. Its peers are the
app's own: `@tanstack/react-query`, `@trpc/*`, `react`, `react-toastify`.

Toasts render into the app's `<ToastContainer />` (mounted via `@acme/ui`'s
`ToastThemeClient`), so `useGenericErrorHandler` needs that present to be
visible.
