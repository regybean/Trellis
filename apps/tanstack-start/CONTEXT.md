# App (`apps/tanstack-start`)

A second runnable application built on TanStack Start (Vite + Nitro), at full
feature parity with `apps/nextjs` — it wires the same feature slices (`@acme/chat`,
`@acme/ingest`, `@acme/billing`, `@acme/admin`) into a product. It exists to prove
the feature slices are framework-portable and to let a divergent shell sit over the
same business logic. Owns no business logic — it is the integration layer plus an
app-local shell. Runs on port 3001.

## Language

**Server route handler**:
A file route that bridges a feature's tRPC router to an HTTP endpoint via
`createFileRoute('/api/trpc/{feature}/$')({ server: { handlers: { GET, POST } } })`
and `fetchRequestHandler`. The TanStack Start analogue of the Next.js _route handler_.

**Clerk resolver** (`src/lib/clerk-context.ts`):
The app-owned `resolveClerkContext` that turns a `Request` into the injected
`{ auth, user, headers, req }` the tRPC context expects. The per-app half of the
framework-agnostic auth seam — see
[`docs/adr/0003`](../../docs/adr/0003-framework-agnostic-auth-seam.md).
_Avoid_: "auth middleware" (that's Clerk's `clerkMiddleware()` in `src/start.ts`).

**Telemetry bootstrap** (Nitro startup plugin):
The app-owned hook that calls `initTelemetry()` once at server startup to register
the OpenTelemetry SDK. The per-app half of the telemetry seam: the platform
(`@acme/trpc`) no longer assumes a framework left an ambient span — each app
initializes the SDK at its own server boundary, just as each app owns its _Clerk
resolver_. Unlike `apps/nextjs` (whose `instrumentation.ts` preloads full HTTP
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
`messageFeedback` table from `@acme/feedback/schema`. Mastra's `mastra_*` tables
are deliberately excluded (the `!mastra_*` tablesFilter in `drizzle.push.config.ts`);
Mastra owns their DDL at runtime — see
[ADR 0002](../../docs/adr/0002-mastra-rag-and-memory.md). Run `db:push` (dev) or
`db:migrate` (deploy) before booting the app on a fresh DB.

## Structure

| Path                                                    | Purpose                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/start.ts`                                          | `createStart()` registering Clerk's `clerkMiddleware()` request middleware |
| `src/router.tsx`                                        | Router + `setupRouterSsrQueryIntegration` (SSR react-query hydration)      |
| `src/routes/__root.tsx`                                 | ClerkProvider → theme (forced dark) → feature providers → console shell    |
| `src/routes/index.tsx`                                  | App-owned console landing home                                             |
| `src/routes/chat-assistant.tsx`                         | Chat UI page — renders `ChatAssistant` from `@acme/chat` (auth-guarded)    |
| `src/routes/admin.tsx`                                  | Admin dashboard — role-guarded `beforeLoad`, loader via `src/lib/admin`    |
| `src/routes/pricing.tsx`                                | Pricing page — renders `PricingPage` from `@acme/billing`                  |
| `src/routes/stripe.success.tsx`                         | Post-checkout redirect — loader runs `syncStripeOnSuccess`                 |
| `src/routes/sign-in.$.tsx`, `sign-up.$.tsx`             | In-app Clerk auth pages (`routing="path"`)                                 |
| `src/routes/privacy-policy.tsx`, `terms-of-service.tsx` | Static legal pages                                                         |
| `src/routes/api/trpc/{billing,chat,ingest}.$.ts`        | Server route handlers per feature router                                   |
| `src/routes/api/stripe.ts`                              | Stripe webhook receiver                                                    |
| `src/routes/api/health.ts`                              | Health check endpoint                                                      |
| `src/lib/clerk-context.ts`                              | The Clerk resolver — injects auth + user into the tRPC context             |
| `src/lib/auth.ts`                                       | `getAuthState` server fn used by `beforeLoad` route guards                 |
| `src/lib/admin.ts`                                      | `listUsers` / `setUserRole` / `removeUserRole` server fns                  |
| `src/lib/stripe.ts`                                     | `syncStripeOnSuccess` server fn                                            |
| `src/server/app-schema.ts`                              | App-owned `pgSchema` (per-app isolation, named off `NEXT_PUBLIC_WEBAPP`)   |
| `src/server/db/schema.ts`                               | drizzle-kit entrypoint — re-exports `appSchema` + `messageFeedback`        |
| `drizzle.config.ts`, `drizzle.push.config.ts`           | drizzle-kit configs (generate/migrate; push excludes `mastra_*`)           |
| `src/components/`                                       | App-local shell + framework-coupled glue (console shell, admin, stripe)    |

## Relationships

- Each feature's `TRPCReactProvider` is mounted in `__root.tsx` and points to its
  `/api/trpc/{feature}` endpoint — same as `apps/nextjs`.
- Auth is resolved at the HTTP boundary by the Clerk resolver and injected into
  `createTRPCContext`; features never resolve auth themselves
  ([ADR 0003](../../docs/adr/0003-framework-agnostic-auth-seam.md)).
- `beforeLoad` route guards replace Next.js middleware for auth / admin gating.
- Framework-coupled glue (admin role mutations, stripe-success redirect) lives in
  this app, reusing only the neutral presentational components from `@acme/admin`
  and `@acme/billing`. No new composition package was added.
- `chat.stream` SSE rides the `/api/trpc/chat/$` GET handler through Nitro via
  `httpSubscriptionLink` — no extra wiring.
