# Recipe: the route seam and per-feature routes

Every feature package exports a tRPC router and a context factory from its
`./server` subpath. Serving them takes two kinds of file in your app: **one**
route seam, and **one** small route file per feature.

## 1. The route seam

The seam turns a router into your framework's HTTP handler. Write it once.
`@acme/trpc/handler` supplies the fetch-adapter wiring, error logging and CORS
policy; your seam supplies the framework shape and the context resolver.

```ts
// Your app's route seam. One per app.
import { corsPreflightHeaders, createTRPCFetchHandler } from '@acme/trpc/handler';

const resolveContext = async (req: Request) => ({
  headers: req.headers,
  req,
  origin: new URL(req.url).origin,
  session: { user: /* your provider's user, mapped onto InjectedSession */ },
  entitlements: /* your EntitlementsProvider */,
});

export function createRouteHandlers({ endpoint, router, createContext }) {
  const handler = createTRPCFetchHandler({
    endpoint,
    router,
    createContext,
    resolver: resolveContext,
  });
  return {
    GET: handler,
    POST: handler,
    OPTIONS: () => new Response(null, { status: 204, headers: corsPreflightHeaders }),
  };
}
```

Points that matter:

- **GET and POST share the handler.** POST carries mutations; GET also carries
  `httpSubscriptionLink` SSE streams. Streaming features need no extra wiring.
- **`Response` is constructed in your app,** not in `@acme/trpc`. The global
  comes from your framework's runtime, so building it in a platform package
  would cross a Node-vs-DOM type boundary.
- **Adapting to your framework** is the only thing that changes between apps —
  the handler shape a route file must export (a bare function, or one taking a
  `{ request }` object, or something else).

## 2. What the resolver must return

The context object is the contract between your app and every feature. Features
never look at your auth provider or your billing provider; they read these
fields.

| Field          | Required | What supplies it                                                         |
| -------------- | -------- | ------------------------------------------------------------------------ |
| `headers`      | yes      | The request's `Headers`                                                  |
| `req` / `res`  | no       | The request, for procedures that need it                                 |
| `origin`       | no       | Your app's public origin, for packages building absolute redirects       |
| `session`      | yes      | `InjectedSession` — your provider's user mapped onto a neutral principal |
| `entitlements` | yes      | An `EntitlementsProvider`                                                |

`session` and `entitlements` are required with no default on purpose: a
deployment has to state whether it has auth and whether it has billing, rather
than inheriting an answer. A build with neither injects a constant principal and
an unlimited provider — see [ADR 0003](../adr/0003-framework-agnostic-auth-seam.md)
and [ADR 0010](../adr/0010-slim-no-auth-apps.md).

## 3. Per-feature routes

One file per feature, mounted at a path of your choosing.

```ts
import { appRouter, createTRPCContext } from "@acme/<feature>/server";

export const { GET, POST, OPTIONS } = createRouteHandlers({
  endpoint: "/api/trpc/<feature>",
  router: appRouter,
  createContext: createTRPCContext,
});
```

`endpoint` must match the path the file is actually mounted at. tRPC strips that
prefix to find the procedure name, so a mismatch produces confusing
procedure-not-found errors rather than a 404.

The feature's client provider needs the same path — see
[provider.md](provider.md).

## 4. A catch-all worth adding

A missing per-feature route looks like a generic 404. Mounting a catch-all at
the parent path that logs "you asked for a tRPC path with no feature route
mounted" turns the commonest mounting mistake into a message that says what to
do.

## 5. Testing

`@acme/trpc/testing` builds the same context shape your seam does, so procedure
tests exercise the real contract. See [docs/TESTING.md](../TESTING.md).
