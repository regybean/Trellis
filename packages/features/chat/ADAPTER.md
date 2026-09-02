# Mounting `@acme/chat`

Five pieces of glue: a tRPC route, a client provider, a page, one table in the
app's drizzle schema, and a worker. The worker is the one people forget — without
it `chat.send` enqueues a Turn that nothing ever generates, and the UI waits
forever on a stream that never fills.

## Mounted by

All four apps.

- `apps/nextjs` — `src/app/api/trpc/chat/[trpc]/route.ts`,
  `src/components/pages/layout/persisted-feature-providers.tsx`,
  `src/app/chat-assistant/chat-view.tsx`,
  `src/app/chat-assistant/[[...sessionId]]/page.tsx`,
  `src/server/db/schema.ts`, `src/env.ts`, `worker.ts`
- `apps/nextjs-slim` — same, minus the app adapter (it mounts `ChatTRPCProvider`
  straight in `src/app/layout.tsx` with `scopeKey="anon"`)
- `apps/tanstack-start` — `src/routes/api/trpc/chat.$.ts`,
  `src/components/persisted-feature-providers.tsx`,
  `src/components/chat-view.tsx`,
  `src/routes/chat-assistant.{-$sessionId}.tsx`, `src/server/db/schema.ts`,
  `src/env.ts`, `worker.ts`
- `apps/tanstack-slim` — same shape

## Glue

### 1. The route — `apps/nextjs/src/app/api/trpc/chat/[trpc]/route.ts`

```ts
import { appRouter, createTRPCContext } from '@acme/chat/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/chat',
  router: appRouter,
  createContext: createTRPCContext,
});
```

GET is not optional here: `chat.stream` is an SSE subscription
(`httpSubscriptionLink`) served over the same handler.

The procedures are `protectedProcedure`, so the app's context resolver must
supply a non-null principal — Mastra memory is scoped by it. A no-auth app
injects a constant one (`@acme/entitlements`'s `ADAPTER.md`).

### 2. The client provider — `apps/nextjs/src/components/pages/layout/persisted-feature-providers.tsx`

```tsx
import { ChatTRPCProvider, clearChatPersistedCache } from '@acme/chat';

<ChatTRPCProvider scopeKey={scopeKey}>…</ChatTRPCProvider>;
```

`scopeKey` is the signed-in user's id and must be **server-resolved**, or the
feature builds its persister before the id arrives and attaches none:

```tsx
// apps/nextjs/src/app/layout.tsx
const session = await auth.api.getSession({ headers: await headers() });
const userId = session?.user.id ?? null;
…
<PersistedFeatureProviders scopeKey={userId ?? undefined}>
```

Signed out ⇒ `scopeKey` undefined ⇒ network-only. A no-auth app passes a
constant instead — `apps/nextjs-slim/src/app/layout.tsx` uses
`<ChatTRPCProvider scopeKey="anon">`.

The provider renders **no** QueryClient of its own (ADR 0036), so it must sit
below the app's one.

`clearChatPersistedCache` is what the app composes into its single logout clear
— see `@acme/hooks`'s `ADAPTER.md`.

### 3. The page, via an app-owned adapter — `apps/nextjs/src/app/chat-assistant/chat-view.tsx`

```tsx
'use client';

import { useTRPC as useBillingTRPC } from '@acme/billing';
import { ConversationView } from '@acme/chat';
import { FeedbackButtons } from '@acme/feedback';

export function ChatView({ initialSessionId }: { initialSessionId?: string }) {
  const queryClient = useQueryClient();
  const billingTrpc = useBillingTRPC();

  const handleTokensConsumed = () => {
    void queryClient.invalidateQueries(
      billingTrpc.account.getCreditUsage.pathFilter(),
    );
  };

  return (
    <ConversationView
      initialSessionId={initialSessionId}
      onTokensConsumed={handleTokensConsumed}
      renderMessageActions={(message) =>
        message.id && message.sessionId ? (
          <FeedbackButtons
            messageId={message.id}
            threadId={message.sessionId}
          />
        ) : null
      }
    />
  );
}
```

This adapter is the point of the whole design: `ConversationView` takes a
callback and a render-slot, so `@acme/chat` depends on neither `@acme/billing`
nor `@acme/feedback`. A slim app mounts `ConversationView` with neither prop and
drops both packages from its graph.

### 4. The route shape matters — `apps/nextjs/src/app/chat-assistant/[[...sessionId]]/page.tsx`

```tsx
// Single route for both the new-Conversation landing (`/chat-assistant`) and
// deep links (`/chat-assistant/{sessionId}`). An optional catch-all keeps both
// on the SAME rendered segment, so ConversationView stamping the id on first
// send is a shallow same-segment URL rewrite — no route remount that would tear
// the SSE stream, and no missing-segment manifest crash under Next's dev router.
```

Two separate routes will remount on first send and tear the stream.

### 5. The table — `apps/nextjs/src/server/db/schema.ts`

```ts
export { chatFolder } from '@acme/chat/schema';
```

One table (`chatFolder`). The conversation/message tables are Mastra's, created
at runtime — see `@acme/rag`'s `ADAPTER.md` for the `!mastra_*` push filter.

### 6. The worker — `apps/nextjs/worker.ts`

```ts
import { createChatGenerationProcessor } from '@acme/chat/server';
import { createWorker, QUEUE_NAMES } from '@acme/queue';

const worker = createWorker(
  QUEUE_NAMES.GENERATION,
  createChatGenerationProcessor(entitlements),
);
```

The processor takes the **same** `EntitlementsProvider` the route handler
injects, so a generation error refunds the ledger that charged.

### 7. Compose the env — `apps/nextjs/src/env.ts`

```ts
import { chatEnv } from '@acme/chat/env';

export const env = createEnv({
  extends: [chatEnv(), ingestEnv(), billingEnv(), betterAuthEnv()],
  …
});
```

## Env

Factory: `src/env.ts`, exported as `@acme/chat/env` (`chatEnv()`).

| Key                        | Kind     | Authored development value                                                                                              |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `CREDITS_PER_TURN`         | config   | `1` — the consume and every refund path read this                                                                       |
| `INFLIGHT_LOCK_TTL`        | config   | `600` (s) — doubles as the crash-recovery bound                                                                         |
| `ABORT_SIGNAL_TTL`         | config   | `600` (s)                                                                                                               |
| `STREAM_POST_TERMINAL_TTL` | config   | `60` (s)                                                                                                                |
| `STREAM_SAFETY_TTL`        | config   | `600` (s) — stamped on the stream key by the worker                                                                     |
| `POLL_INTERVAL_MS`         | config   | `100` — reader poll while draining                                                                                      |
| `QUEUE_REMOVE_ON_COMPLETE` | config   | `1000` — BullMQ retention                                                                                               |
| `QUEUE_REMOVE_ON_FAIL`     | config   | `1000`                                                                                                                  |
| `NEXT_PUBLIC_APP_VERSION`  | client   | `0.0.0` — composed into the persister's `buster`, so a deploy that changes the persisted shape discards prior snapshots |
| `NEXT_PUBLIC_WEBAPP`       | selector | Postgres/pgvector schema + Redis prefix                                                                                 |
| `NODE_ENV`                 | selector | shared                                                                                                                  |

No secrets. `MAX_MESSAGE_LENGTH` is deliberately a code constant in
`chat-schema.ts` — an env-invariant validation limit read in the client-safe
barrel.

## Infra

`acme.infra: ["postgres", "ollama"]` → the `postgres` and `ollama` profiles in
`deploy/compose.yaml`. Redis is pulled in transitively (durable stream, Turn
lifecycle keys, BullMQ) via `@acme/redis` and `@acme/queue`, so `pnpm infra:up`
starts it too — the union is computed over the whole workspace closure
(ADR 0009).

## Also mount

`@acme/trpc` (the route seam), `@acme/queue` (the worker), `@acme/hooks` (the one
QueryClient), `@acme/ui`, `@acme/rag` (memory + retrieval), `@acme/models`,
`@acme/db`, `@acme/redis`, `@acme/entitlements` or `@acme/subscriptions`,
`@acme/logger`, `@acme/env`.
