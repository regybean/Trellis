# Mounting `@acme/feedback`

The smallest full-stack slice here, and a good one to read first: a tRPC route, a
client provider, two tables, and a component rendered into another feature's
render-slot. No worker, no secrets, no tunables.

## Mounted by

- `apps/nextjs` — `src/app/api/trpc/feedback/[trpc]/route.ts`,
  `src/components/pages/layout/persisted-feature-providers.tsx`,
  `src/app/chat-assistant/chat-view.tsx`, `src/server/db/schema.ts`
- `apps/tanstack-start` — `src/routes/api/trpc/feedback.$.ts`,
  `src/components/persisted-feature-providers.tsx`,
  `src/components/chat-view.tsx`, `src/server/db/schema.ts`

The slim apps mount neither, which is what makes it a mountable subset rather
than a fixture.

## Glue

### 1. The route — `apps/nextjs/src/app/api/trpc/feedback/[trpc]/route.ts`

```ts
import { appRouter, createTRPCContext } from '@acme/feedback/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/feedback',
  router: appRouter,
  createContext: createTRPCContext,
});
```

TanStack Start — `apps/tanstack-start/src/routes/api/trpc/feedback.$.ts` — is the
same wrapped in `createFileRoute('/api/trpc/feedback/$')`.

### 2. The client provider — `apps/nextjs/src/components/pages/layout/persisted-feature-providers.tsx`

```tsx
import {
  clearPersistedCache as clearFeedbackPersistedCache,
  FeedbackTRPCProvider,
} from '@acme/feedback';

<FeedbackTRPCProvider scopeKey={scopeKey}>…</FeedbackTRPCProvider>;
```

Note the import alias. This package exports `clearPersistedCache` under its
plain name (chat and ingest prefix theirs), so an app mounting more than one
renames it at the import — the alias above is the copied line, not a suggestion.

`scopeKey` is the server-resolved user id; the provider renders no QueryClient of
its own (ADR 0036), so it sits below the app's one. Nesting order among the three
feature providers carries no meaning.

### 3. The component, into chat's render-slot — `apps/nextjs/src/app/chat-assistant/chat-view.tsx`

```tsx
import { FeedbackButtons } from '@acme/feedback';

<ConversationView
  renderMessageActions={(message) =>
    message.id && message.sessionId ? (
      <FeedbackButtons messageId={message.id} threadId={message.sessionId} />
    ) : null
  }
/>;
```

The app wires the two features together. `@acme/chat` does not depend on
`@acme/feedback` — it exposes a slot, and the app decides to fill it. That is why
the slim apps can drop this package without touching chat.

`FeedbackButtons` takes the message and thread ids by value, so it needs nothing
from chat's internals.

### 4. The tables — `apps/nextjs/src/server/db/schema.ts`

```ts
export { messageFeedback, feedbackRating } from '@acme/feedback/schema';
```

`messageFeedback` is the table; `feedbackRating` its enum. Both carry
Mastra-owned message/thread ids **by value with no FK** — the rows they point at
are in tables drizzle-kit does not manage (ADR 0002).

### 5. Env composition

Nothing to add. This slice declares only selectors, and every app that mounts it
already composes them through another slice — so no app's `env.ts` calls
`feedbackEnv()`.

## Env

Factory: `src/env.ts`, exported as `@acme/feedback/env` (`feedbackEnv()`).

| Key                  | Kind     | Notes                                  |
| -------------------- | -------- | -------------------------------------- |
| `NEXT_PUBLIC_WEBAPP` | selector | per-app Postgres schema + Redis prefix |
| `NODE_ENV`           | selector | shared                                 |

Selectors only — no tunables and no secrets of its own.

## Infra

`acme.infra: ["postgres", "redis"]` → the `postgres` and `redis` profiles in
`deploy/compose.yaml`. Postgres for its own tables; redis arrives through the
slice's dependency closure rather than a direct client in `src/`.

## Also mount

`@acme/trpc` (the route seam), `@acme/hooks` (the one QueryClient),
`@acme/db`, `@acme/rag` (thread ownership), `@acme/ui`, `@acme/logger`,
`@acme/env`. In practice also `@acme/chat`, since the render-slot is where the
UI lands.
