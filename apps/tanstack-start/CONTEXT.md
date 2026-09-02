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
`{ session, entitlements, headers, req, origin }` the tRPC context expects. The
per-app half of the auth seam — see
[ADR 0034](../../docs/adr/0034-better-auth-replaces-clerk.md) and
[ADR 0003](../../docs/adr/0003-framework-agnostic-auth-seam.md). It reads the
session off the request's own `Cookie` header, so nothing has to run before it.
It hands the resolved session to `@acme/auth/server`'s `toPrincipal` rather than
mapping it here: resolution is app-owned, the mapping is provider-owned and
shared with `apps/nextjs` (#239).
_Avoid_: "auth middleware" — there is none. The Clerk wiring needed
`clerkMiddleware()` registered in `src/start.ts` to make `auth()` work at all;
`src/start.ts` now registers only the CSRF guard.

**Auth instance** (`src/lib/auth-server.ts`):
`initAuth({ baseUrl })` — _this app's_ Better Auth instance, the one thing all
three server-side auth consumers share (the catch-all handler, the route guards,
the tRPC resolver). `baseUrl` comes from the app-authored `BETTER_AUTH_URL`
because each app runs on its own port; the secret does not, because
`BETTER_AUTH_SECRET` is slice-owned inside `@acme/auth/env`.
_Avoid_: "the auth client" — that is `src/lib/auth-client.ts`, browser-side, and
holds no secret.

**Auth catch-all** (`src/routes/api/auth.$.ts`):
The single route mounting `auth.handler` at Better Auth's default `/api/auth`
base path. Every credential operation the browser performs is an HTTP call
underneath it. Deliberately outside the `beforeLoad` guards — gating the sign-in
endpoint behind a signed-in check is a redirect loop.

**Telemetry bootstrap** (Nitro startup plugin):
The app-owned hook that calls `initTelemetry()` once at server startup to register
the OpenTelemetry SDK. The per-app half of the telemetry seam: the platform
(`@acme/trpc`) no longer assumes a framework left an ambient span — each app
initializes the SDK at its own server boundary, just as each app owns its
_session resolver_. Unlike `apps/nextjs` (whose `instrumentation.ts` preloads full HTTP
auto-instrumentation), this plugin registers the SDK after server modules load, so
traces are rooted at the tRPC procedure span (`trpc.<path>`) rather than an HTTP
parent. _Avoid_: "instrumentation file" (that's the Next.js mechanism).

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
database ([ADR 0035](../../docs/adr/0035-auth-tables-in-a-dedicated-schema.md)) —
`auth` is therefore the second entry in both drizzle configs' `schemaFilter`, and
without it push would ignore them. Mastra's `mastra_*` tables
are deliberately excluded (the `!mastra_*` tablesFilter in `drizzle.push.config.ts`);
Mastra owns their DDL at runtime — see
[ADR 0002](../../docs/adr/0002-mastra-rag-and-memory.md). Run `db:push` (dev) or
`db:migrate` (deploy) before booting the app on a fresh DB.

## Structure

| Path                                                    | Purpose                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/start.ts`                                          | `createStart()` registering the CSRF guard — auth needs no middleware                                |
| `src/router.tsx`                                        | Router + `setupRouterSsrQueryIntegration` (SSR react-query hydration)                                |
| `src/routes/__root.tsx`                                 | theme (forced dark) → feature providers → console shell; no auth provider                            |
| `src/routes/index.tsx`                                  | App-owned console landing home                                                                       |
| `src/routes/chat-assistant.tsx`                         | Chat UI page — renders `ChatAssistant` from `@acme/chat` (auth-guarded)                              |
| `src/routes/admin.tsx`                                  | Admin dashboard — role-guarded `beforeLoad`, loader via `src/lib/admin`                              |
| `src/routes/pricing.tsx`                                | Pricing page — renders `PricingPage` from `@acme/billing`                                            |
| `src/routes/stripe.success.tsx`                         | Post-checkout redirect — loader runs `syncStripeOnSuccess`                                           |
| `src/routes/sign-in.tsx`, `sign-up.tsx`                 | In-app auth pages — `@acme/ui` forms over `authClient`                                               |
| `src/routes/privacy-policy.tsx`, `terms-of-service.tsx` | Static legal pages                                                                                   |
| `src/routes/api/auth.$.ts`                              | Better Auth catch-all — mounts `auth.handler`                                                        |
| `src/routes/api/trpc/{billing,chat,ingest}.$.ts`        | Server route handlers per feature router                                                             |
| `src/routes/api/stripe.ts`                              | Stripe webhook receiver                                                                              |
| `src/routes/api/health.ts`                              | Health check endpoint                                                                                |
| `src/lib/auth-server.ts`                                | The app's Better Auth instance (`initAuth`)                                                          |
| `src/lib/auth-client.ts`                                | `createAuthClient()` — same-origin, no `baseURL`, no plugins                                         |
| `src/lib/trpc-context.ts`                               | The session resolver — injects the principal into the tRPC context                                   |
| `src/lib/auth.ts`                                       | `getAuthState` server fn used by `beforeLoad` route guards                                           |
| `src/lib/auth-redirect.ts`                              | `redirectToSignIn` — the guards' router-shaped throw (the _rule_ is `@acme/ui`'s `authSearchSchema`) |
| `src/lib/admin.ts`                                      | `listUsers` / `setUserRole` / `removeUserRole` over the admin plugin                                 |
| `src/lib/stripe.ts`                                     | `syncStripeOnSuccess` server fn                                                                      |
| `src/server/app-schema.ts`                              | App-owned `pgSchema` (per-app isolation, named off `NEXT_PUBLIC_WEBAPP`)                             |
| `src/server/db/schema.ts`                               | drizzle-kit entrypoint — re-exports `appSchema` + `messageFeedback`                                  |
| `drizzle.config.ts`, `drizzle.push.config.ts`           | drizzle-kit configs (generate/migrate; push excludes `mastra_*`)                                     |
| `src/components/`                                       | App-local shell + framework-coupled glue (console shell, admin, stripe)                              |

## Relationships

- Each feature's `TRPCReactProvider` is mounted in `__root.tsx` and points to its
  `/api/trpc/{feature}` endpoint — same as `apps/nextjs`.
- Auth is resolved at the HTTP boundary by the session resolver and injected into
  `createTRPCContext`; features never resolve auth themselves
  ([ADR 0034](../../docs/adr/0034-better-auth-replaces-clerk.md),
  [ADR 0003](../../docs/adr/0003-framework-agnostic-auth-seam.md)).
- `beforeLoad` route guards replace Next.js middleware for auth / admin gating.
  They are also what enforces "nothing fires while signed out": the guard throws
  its redirect before the route's component mounts, so no feature hook ever runs.
  The feature providers in `__root.tsx` only construct clients; they issue no
  requests of their own.
- The signed-in principal is **server-resolved once**, in `__root`'s `beforeLoad`,
  and flows down as route context and props (`scopeKey` to the persisters, `user`
  to the console shell). There is no auth React context and no client-side session
  fetch on load — which is what lets the first paint show the right signed-in
  state and lets the persisters attach on their first render.
- Every request costs one `session` row read. Auth is stateful now, so deleting
  the row revokes the session immediately — `initAuth` turns the cookie cache off
  to keep that true ([ADR 0034](../../docs/adr/0034-better-auth-replaces-clerk.md)).
- Framework-coupled glue (admin role mutations, stripe-success redirect) lives in
  this app. The admin shell is app-owned in `src/components/admin/`, reusing the
  neutral presentational components and `@acme/billing`
  ([ADR 0011](../../docs/adr/0011-remove-compositions-layer.md)).
- `chat.stream` SSE rides the `/api/trpc/chat/$` GET handler through Nitro via
  `httpSubscriptionLink` — no extra wiring.
