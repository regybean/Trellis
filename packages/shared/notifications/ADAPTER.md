# Mounting `@acme/notifications`

Two things: one tRPC route and one provider. The provider is self-contained — it
renders its own tRPC provider and a headless always-on tail inside it, so no page
owns a subscription hook. The mount is byte-identical in all four apps: no
persister, no `scopeKey`, no client principal (the server keys `userId` off the
tRPC context).

## Mounted by

All four apps:

- `apps/nextjs` — `src/app/api/trpc/notifications/[trpc]/route.ts`, `src/app/layout.tsx`
- `apps/nextjs-slim` — same two paths
- `apps/tanstack-start` — `src/routes/api/trpc/notifications.$.ts`, `src/routes/__root.tsx`
- `apps/tanstack-slim` — same two paths

## Glue

### 1. The route — `apps/nextjs/src/app/api/trpc/notifications/[trpc]/route.ts`

```ts
import { appRouter, createTRPCContext } from '@acme/notifications/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/notifications',
  router: appRouter,
  createContext: createTRPCContext,
});
```

TanStack Start — `apps/tanstack-start/src/routes/api/trpc/notifications.$.ts` —
is the same, wrapped in `createFileRoute('/api/trpc/notifications/$')`.

The `stream` procedure is an SSE subscription served over **GET** by the same
fetch handler (`httpSubscriptionLink`), so there is nothing extra to wire — but a
seam that only exposes POST will silently deliver no notifications.

### 2. The provider — `apps/nextjs/src/app/layout.tsx`

```tsx
import { NotificationsProvider } from '@acme/notifications';

<PersistedFeatureProviders scopeKey={userId ?? undefined}>
  <NotificationsProvider>
    <TooltipProvider>
      <EditorialShell>
        <ToastThemeClient />
        {props.children}
      </EditorialShell>
    </TooltipProvider>
  </NotificationsProvider>
</PersistedFeatureProviders>;
```

Mount it once, adjacent to the feature tRPC providers. It renders no
`<ToastContainer />` of its own — the app already mounts one via `@acme/ui`'s
`ToastThemeClient`, and the default renderer toasts into that. Without a
`ToastContainer` somewhere in the tree, notifications arrive and render nothing.

It must sit **below** the app's `AuthStatusProvider`: the tail reads
`useOptionalAuthStatus` and holds the subscription open only once the viewer is
signed in, because `stream` is a `protectedProcedure`. Subscribing while signed
out earns an `UNAUTHORIZED` that tRPC then retries — a burst of error logs for a
denial that was never actionable. The slim apps mount no auth status provider at
all, which is why the hook is the _optional_ one.

### 3. Custom renderers (optional)

```tsx
<NotificationsProvider renderers={{ 'ingest.job-complete': MyRenderer }}>
```

An app-assembled `kind`→renderer registry. Optional: a plain-text kind needs no
entry and falls through to `defaultToastRenderer`.

### 4. Publishing, for a feature not an app

```ts
import { publish } from '@acme/notifications/server';
```

`@acme/ingest` calls this from its worker to fire one completion notification per
job. A consuming feature imports `@acme/notifications/schema` (isomorphic —
`notificationSchema`, `publishInputSchema`, the types) to build its own typed
`publish` wrapper and its renderer's `data` parser; the server validates against
the same shape.

### 5. Delivery contract

Best-effort (ADR 0030): a publish with no page open is never delivered. The
stream carries a rolling TTL refreshed on every publish and no `MAXLEN`, so a
stream with no reader simply expires. Don't wire anything that assumes an inbox
— there is no consumer hook exported.

## Env

Factory: `src/env.ts`, exported as `@acme/notifications/env`.

| Key                | Kind     | Notes                                                                                            |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| `NOTIFICATION_TTL` | config   | authored `3600` (seconds) — rolling, refreshed per publish                                       |
| `POLL_MIN_MS`      | config   | authored `100` — reader idle backoff floor                                                       |
| `POLL_MAX_MS`      | config   | authored `1000` — doubles up to this while the stream is empty, snaps back to MIN on a new entry |
| `NODE_ENV`         | selector | shared                                                                                           |

No secrets. All server-side — `publish` and the reader run on the backend.

## Infra

`acme.infra: ["redis"]` → the `redis` profile in `deploy/compose.yaml`. The
per-user stream is a Redis stream, namespaced per app by `@acme/redis`'s `nsKey`.

## Also mount

`@acme/redis`, `@acme/trpc`, `@acme/hooks` (the auth-status seam and the query
client), `@acme/logger`, `@acme/env`. The app must already have the tRPC
route-handler seam from `@acme/trpc`'s `ADAPTER.md` and one QueryClient from
`@acme/hooks`'s.
