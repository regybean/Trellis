# Mounting `@acme/trpc`

An app mounts this by writing **one** route-handler seam of its own, then a
three-line route file per feature. The seam is where the app's auth and billing
choices are injected; the feature route files stay ignorant of both.

That split is the whole reason this package exists as a platform package: the
fetch-adapter wiring, error logging and CORS policy live here once, and the app
owns only the framework shape plus the context resolver.

## Mounted by

All four apps:

- `apps/nextjs` — `src/server/trpc-route.ts` + `src/app/api/trpc/<feature>/[trpc]/route.ts`
- `apps/nextjs-slim` — `src/server/trpc-route.ts` + the same route layout
- `apps/tanstack-start` — `src/lib/trpc-route.ts` + `src/routes/api/trpc/<feature>.$.ts`
- `apps/tanstack-slim` — `src/lib/trpc-route.ts` + the same route layout

## Glue

### 1. The app-owned seam, Next.js — `apps/nextjs/src/server/trpc-route.ts`

```ts
import type { AnyRouter } from '@trpc/server';

import { toPrincipal } from '@acme/auth/server';
import { env as billingEnv, toPlanIds } from '@acme/billing/env';
import { createSubscriptionsEntitlements } from '@acme/subscriptions';
import {
  corsPreflightHeaders,
  createTRPCFetchHandler,
} from '@acme/trpc/handler';

import { auth } from './auth';

const entitlements = createSubscriptionsEntitlements(toPlanIds(billingEnv));

const resolveSession = async (req: Request) => ({
  user: toPrincipal(await auth.api.getSession({ headers: req.headers })),
});

const resolveContext = async (req: Request) => ({
  headers: req.headers,
  req,
  origin: new URL(req.url).origin,
  session: await resolveSession(req),
  entitlements,
});

/** CORS preflight: a 204 with the shared cross-app CORS policy. */
const handleOptions = () =>
  new Response(null, { status: 204, headers: corsPreflightHeaders });

export function createTRPCRouteHandlers<TRouter extends AnyRouter>({
  endpoint,
  router,
  createContext,
}: TRPCRouteOptions<TRouter>) {
  const handler = createTRPCFetchHandler({
    endpoint,
    router,
    createContext,
    resolver: resolveContext,
  });

  return { GET: handler, POST: handler, OPTIONS: handleOptions };
}
```

The same fetch handler serves GET and POST — POST for mutations, GET also
carrying `httpSubscriptionLink` SSE streams such as `chat.stream`. So SSE needs
no extra wiring.

`Response` is constructed in the app, not in `@acme/trpc`: the global comes from
the framework runtime (Next vs Nitro), and building it in the platform would
cross a Node-vs-DOM `Response` type boundary. The policy lives here once; the
one-line construction stays at the seam.

### 2. The same seam, TanStack Start — `apps/tanstack-start/src/lib/trpc-route.ts`

```ts
export function createTRPCServerHandlers<TRouter extends AnyRouter>({
  endpoint,
  router,
  createContext,
}: TRPCRouteOptions<TRouter>) {
  const handler = createTRPCFetchHandler({
    endpoint,
    router,
    createContext,
    resolver: resolveAuthContext,
  });

  return {
    GET: ({ request }: { request: Request }) => handler(request),
    POST: ({ request }: { request: Request }) => handler(request),
    OPTIONS: () =>
      new Response(null, { status: 204, headers: corsPreflightHeaders }),
  };
}
```

Identical apart from the handler shape the framework expects. Comparing the two
files is the cheapest way to see what is framework-specific and what is not.

### 3. One route file per feature — `apps/nextjs/src/app/api/trpc/chat/[trpc]/route.ts`

```ts
import { appRouter, createTRPCContext } from '@acme/chat/server';

import { createTRPCRouteHandlers } from '~/server/trpc-route';

export const { GET, POST, OPTIONS } = createTRPCRouteHandlers({
  endpoint: '/api/trpc/chat',
  router: appRouter,
  createContext: createTRPCContext,
});
```

TanStack's equivalent adds only the `createFileRoute` path literal that the
route-tree codegen statically requires. `endpoint` must match the mount path or
tRPC strips the wrong prefix off procedure paths.

### 4. A catch-all that fails loudly — `apps/nextjs/src/app/api/trpc/[trpc]/route.ts`

```ts
const handler = (_req: Request) => {
  logger.warn({
    message:
      'Unidentified tRPC path. You must call a procedure path like /api/trpc/<nameofrouter>/<procedure> (or use the tRPC client within the package).',
    hint: 'If you expected tRPC to work here, ensure you have src/app/api/trpc/<name> (from package -> react.tsx -> api/trpc/<name>)/[trpc]/route.ts definition from the package you import.',
  });
  …
};
```

Worth copying: a missing per-feature route otherwise looks like a generic 404.

### 5. What the resolver must return

`createTRPCContext`'s input (`ContextOpts`) is the contract between app and
feature:

| Field          | Required | Who supplies it                                                                                                 |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `headers`      | yes      | the request's own `Headers`                                                                                     |
| `req` / `res`  | no       | the request, where a procedure needs it                                                                         |
| `origin`       | no       | the app's public origin — billing builds absolute Stripe redirects from it; a build with no billing can omit it |
| `session`      | yes      | `InjectedSession` — the app maps its provider's user onto it                                                    |
| `entitlements` | yes      | `EntitlementsProvider`, with no implicit default                                                                |

`session` and `entitlements` are both required with no default, which is the
seam being explicit rather than convenient: a deployment must state whether it
has auth and whether it has billing. `@acme/auth`'s `toPrincipal` does the
mapping for the full apps; the slim apps inject a constant principal and
`unlimitedEntitlements` (ADR 0003 / ADR 0010).

### 6. Testing

`@acme/trpc/testing` exports the test-context builder feature suites call, so a
consumer's procedure tests construct the same context shape the route handler
does.

## Env

Factory: none. `@acme/trpc` reads no environment — every per-deploy value it
touches arrives through the injected context.

## Infra

None — no `acme.infra`.

## Also mount

`@acme/entitlements` (the provider type), `@acme/telemetry` (the per-procedure
span; ambient, nothing to thread — ADR 0023), `@acme/logger`.
