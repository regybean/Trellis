# App (`apps/tanstack-start`)

A second runnable application built on TanStack Start (Vite + Nitro), at full
feature parity with `apps/nextjs` — it wires the same feature slices (`@acme/chat`,
`@acme/ingest`, `@acme/billing`) into a product. It exists to prove
the feature slices are framework-portable and to let a divergent shell sit over the
same business logic. Owns no business logic — it is the integration layer plus an
app-local shell. Runs on port 3001.

## Language

**Server route handler**:
A file route that bridges a feature's tRPC router to an HTTP endpoint via
`createFileRoute('/api/trpc/{feature}/$')({ server: { handlers: { GET, POST } } })`
and `fetchRequestHandler`. The TanStack Start analogue of the Next.js _route handler_.

**Session resolver** (`src/lib/trpc-context.ts`):
The app-owned `resolveAuthContext` that turns a `Request` into the injected
`{ session, headers, req, origin }` the tRPC base context expects; its sibling
`resolveAuthContextWithEntitlements` adds the entitlements provider — imported
from `~/server/deps`, not built here — for the chat and billing mounts, which
declare it. The per-app half of the auth seam. It reads the
session off the request's own `Cookie` header, so nothing has to run before it.
It hands the resolved session to `@acme/auth/server`'s `toPrincipal` rather than
mapping it here: resolution is app-owned, the mapping is provider-owned and
shared with `apps/nextjs`.
_Avoid_: "auth middleware" — there is none. `src/start.ts` registers only the
CSRF guard; nothing has to be installed for a session to resolve.

**Auth instance** (`src/lib/auth-server.ts`):
`initAuth({ baseUrl })` — _this app's_ Better Auth instance, the one thing all
three server-side auth consumers share (the catch-all handler, the route guards,
the tRPC resolver). `baseUrl` comes from the app-authored `BETTER_AUTH_URL`
because each app runs on its own port; the secret does not, because
`BETTER_AUTH_SECRET` is slice-owned inside `@acme/auth/env`.
_Avoid_: "the auth client" — that is `src/lib/auth-client.ts`, browser-side,
same-origin with no `baseURL` and no plugins, and holds no secret.

**Auth catch-all** (`src/routes/api/auth.$.ts`):
The single route mounting `auth.handler` at Better Auth's default `/api/auth`
base path. Every credential operation the browser performs is an HTTP call
underneath it. Deliberately outside the `beforeLoad` guards — gating the sign-in
endpoint behind a signed-in check is a redirect loop.

**Composition root** (`src/server/deps.ts`):
The one file where every implementation this app injects into a seam is
constructed, and both entry points — `src/lib/trpc-context.ts` and `worker.ts` —
import the result. Today that is the Stripe/Redis entitlements provider,
`createSubscriptionsEntitlements(toPlanIds(billingEnv))`. Lint keeps the
factories out of every other file in this app. Construction
lives in `src/server/`; request-time resolution stays in `src/lib/` and imports
across. Auth is the exception and stays in the resolver: only one entry point
resolves a principal.

**Telemetry bootstrap** (Nitro startup plugin):
The app-owned hook that calls `initTelemetry()` (`trellis-tanstack-start`) once at
server startup to register the OpenTelemetry SDK. The per-app half of the
telemetry seam. _Avoid_: "instrumentation file" (that's the Next.js mechanism).

**Console shell** (`src/components/console-shell.tsx`):
The app-local dark/dense "developer console" chrome (left rail + top bar + status
bar) that wraps every page. The deliberate visual divergence from `apps/nextjs`;
feature components are reused untouched.

**App-owned Postgres schema** (`src/server/app-schema.ts`):
The per-app `pgSchema` named off `NEXT_PUBLIC_WEBAPP` (falls back to
`tanstack-start`), isolating this app's tables from `apps/nextjs` in the same
database. `src/server/db/schema.ts` is the drizzle-kit entrypoint — it re-exports
`appSchema` (so push/generate own `CREATE SCHEMA`) plus the app-owned
`messageFeedback` table from `@acme/feedback/schema`. It also re-exports Better
Auth's four tables from `@acme/auth/schema`, which sit in a constant `auth`
schema rather than `appSchema` because identity is shared across the apps on one
database — `auth` is therefore the second entry in both drizzle configs'
`schemaFilter`, and without it push would ignore them. Mastra's `mastra_*` tables
are deliberately excluded (the `!mastra_*` tablesFilter in `drizzle.push.config.ts`);
Mastra owns their DDL at runtime. Run `db:push` (dev) or
`db:migrate` (deploy) before booting the app on a fresh DB.

**Worker entrypoint** (`worker.ts`):
The generation + ingest worker's process entrypoint, and the second consumer of
the composition root alongside the session resolver.

## Relationships

- Each feature's `TRPCProvider` is mounted in `__root.tsx` and points to its
  `/api/trpc/{feature}` endpoint — same as `apps/nextjs`.
- The app's **one** `QueryClient` is created in `src/router.tsx` and mounted by the
  router's `Wrap`. The `*TRPCProvider`s above are tRPC providers despite the
  name — they render no `QueryClientProvider` of their own and read this one from
  context, so their queries reach `setupRouterSsrQueryIntegration` instead of
  being shadowed by a nested client.
- Auth is resolved at the HTTP boundary by the session resolver and put on the
  tRPC context it returns; features never resolve auth themselves.
- `beforeLoad` route guards replace Next.js middleware for auth / admin gating.
  They are also what enforces "nothing fires while signed out": the guard throws
  its redirect before the route's component mounts, so no feature hook ever runs.
  The feature providers in `__root.tsx` only construct clients; they issue no
  requests of their own.
- `@acme/ui` owns the sign-in redirect _rule_ (`authSearchSchema`);
  `src/lib/auth-redirect.ts` holds only the guards' router-shaped throw,
  `redirectToSignIn`.
- The signed-in principal is **server-resolved once**, in `__root`'s `beforeLoad`,
  and flows down as route context and props (`scopeKey` to the persisters, `user`
  to the console shell). There is no auth React context and no client-side session
  fetch on load — which is what lets the first paint show the right signed-in
  state and lets the persisters attach on their first render.
- Every request costs one `session` row read. Auth is stateful, so deleting
  the row revokes the session immediately — `initAuth` turns the cookie cache off
  to keep that true.
- Framework-coupled glue (admin role mutations, stripe-success redirect) lives in
  this app. The admin shell is app-owned in `src/components/admin/`, reusing the
  neutral presentational components and `@acme/billing`.
- `chat.stream` SSE rides the `/api/trpc/chat/$` GET handler through Nitro via
  `httpSubscriptionLink` — no extra wiring.

## Decisions

See [`docs/adr/`](../../docs/adr/).
