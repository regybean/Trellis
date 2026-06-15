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

**Console shell** (`src/components/console-shell.tsx`):
The app-local dark/dense "developer console" chrome (left rail + top bar + status
bar) that wraps every page. The deliberate visual divergence from `apps/nextjs`;
feature components are reused untouched.

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
