# App (`apps/nextjs`)

The deployed Next.js application. Wires feature slices together into a runnable product and owns its shell/chrome + admin assembly. Owns no business logic — it is the integration layer.

## Language

**Route handler**:
A Next.js `route.ts` file that bridges a feature's tRPC router to an HTTP endpoint at `/api/trpc/{feature}/[trpc]`. Each feature has exactly one route handler in this app.
_Avoid_: "API route", "endpoint file"

## Structure

| Path                           | Purpose                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `app/chat-assistant/`          | Chat UI page — renders `ChatAssistant` from `@acme/chat`                        |
| `app/admin/`                   | Admin dashboard page — renders app-owned `AdminDashboard` (`components/admin/`) |
| `app/pricing/`                 | Pricing page — renders `PricingPage` from `@acme/billing`                       |
| `app/stripe/success/`          | Post-checkout redirect handler                                                  |
| `app/sign-in/`, `app/sign-up/` | Auth pages — `SignInForm`/`SignUpForm` from `@acme/ui` over `lib/auth-client`   |
| `app/api/auth/[...all]/`       | Better Auth catch-all handler — every auth endpoint, and the only cookie writer |
| `app/api/trpc/billing/[trpc]/` | Route handler for `@acme/billing` router                                        |
| `app/api/trpc/chat/[trpc]/`    | Route handler for `@acme/chat` router                                           |
| `app/api/trpc/ingest/[trpc]/`  | Route handler for `@acme/ingest` router                                         |
| `app/api/stripe/`              | Stripe webhook receiver                                                         |
| `app/api/health/`              | Health check endpoint                                                           |
| `src/server/deps.ts`           | **Composition root** — every implementation this app injects, built once        |
| `src/server/trpc-route.ts`     | Route-handler builders + the context resolvers each mount names                 |
| `worker.ts`                    | Generation + ingest worker entrypoint                                           |

## Composition root (`src/server/deps.ts`)

Everything this app injects into a seam is constructed here, once, and both entry
points — `src/server/trpc-route.ts` and `worker.ts` — import the result. Today
that is the Stripe/Redis entitlements provider,
`createSubscriptionsEntitlements(toPlanIds(billingEnv))`.

Two independently built providers typecheck and still disagree about which one
charged and which one refunds, so there is only one, and lint keeps the factories
out of every other file in this app ([ADR 0006](../../docs/adr/0006-entitlements-injection-seam.md)).
Auth is the exception, and stays in the route seam: only one entry point resolves
a principal.

## Relationships

- Each feature's `TRPCProvider` wraps its page(s) and points to its `/api/trpc/{feature}` endpoint
- `AppQueryClientProvider` (root `layout.tsx`) mounts the app's **one** `QueryClient`, above every feature provider. The `*TRPCProvider`s above are tRPC providers despite the name — they render no `QueryClientProvider` of their own and read this one from context ([ADR 0036](../../docs/adr/0036-one-app-owned-query-client.md))
- `AdminDashboard` (app-owned, `components/admin/`) guards on the admin role inline via `auth.api.getSession`; the role mutation lives in `src/lib/admin.ts` as a server action ([ADR 0011](../../docs/adr/0011-remove-compositions-layer.md))
- `instrumentation.ts` initialises OpenTelemetry via `@acme/telemetry` at startup

## Auth ([@acme/auth ADR 0001](../../packages/shared/auth/docs/adr/0001-self-hosted-better-auth.md))

Self-hosted Better Auth, sessions as rows in the shared `auth` schema ([@acme/auth ADR 0002](../../packages/shared/auth/docs/adr/0002-auth-tables-in-a-dedicated-schema.md)). The app owns every framework-specific piece; `@acme/auth` ships the instance factory and the tables, and no React at all.

- `server/auth.ts` — the app's `initAuth({ baseUrl })` instance, shared by the route handler, the tRPC resolver and the admin actions
- the mapping onto the neutral `InjectedUser`, and the role read, are **not** here — `toPrincipal` / `readSessionRole` / `toAdminUser` live once in `@acme/auth/server` and are shared with `apps/tanstack-start` (#239). This app owns _resolution_ only. `role` is parsed, not asserted: it is an admin-plugin field that Better Auth omits from `getSession`'s static type
- `lib/auth-client.ts` — the browser client. No provider to mount; `useSession()` reads a nanostore
- `components/pages/layout/better-auth-status.tsx` — publishes the neutral `AuthStatusProvider` (`@acme/hooks`) that `@acme/billing` reads, seeded from the layout's server-resolved session
- `middleware.ts` — an **optimistic** signed-in redirect only (cookie presence, no validation, no database on the Edge), and it exempts `/api/trpc`: a redirect is an answer for a document request, not for a `fetch` that expects a tRPC error envelope. Authorisation is server-side: `protectedProcedure`/`adminProcedure` and the `/admin` page's own role check
- `app/sign-in/page.tsx`, `app/sign-up/page.tsx` — `@acme/ui`'s forms plus this app's provider call. `?redirect=` goes through `@acme/ui`'s `toSameSitePath`, so an off-site value lands on `/` instead of walking the visitor away the moment they authenticate
