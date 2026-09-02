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

## Relationships

- Each feature's `TRPCReactProvider` wraps its page(s) and points to its `/api/trpc/{feature}` endpoint
- `AdminDashboard` (app-owned, `components/admin/`) guards on the admin role inline via `auth.api.getSession`; role mutations live in `src/lib/admin.ts` ([ADR 0011](../../docs/adr/0011-remove-compositions-layer.md))
- `instrumentation.ts` initialises OpenTelemetry via `@acme/telemetry` at startup

## Auth (#223, [ADR 0034](../../docs/adr/0034-better-auth-replaces-clerk.md))

Self-hosted Better Auth, sessions as rows in the shared `auth` schema ([ADR 0035](../../docs/adr/0035-auth-tables-in-a-dedicated-schema.md)). The app owns every framework-specific piece; `@acme/auth` ships the instance factory and the tables, and no React at all.

- `server/auth.ts` — the app's `initAuth({ baseUrl })` instance, shared by the route handler, the tRPC resolver and the admin actions
- `server/session.ts` — the Better Auth → neutral `InjectedUser` mapping, and the role read. `role` is parsed, not asserted: it is an admin-plugin field that Better Auth omits from `getSession`'s static type
- `lib/auth-client.ts` — the browser client. No provider to mount; `useSession()` reads a nanostore
- `components/pages/layout/better-auth-status.tsx` — publishes the neutral `AuthStatusProvider` (`@acme/hooks`) that `@acme/billing` reads, seeded from the layout's server-resolved session
- `middleware.ts` — an **optimistic** signed-in redirect only (cookie presence, no validation, no database on the Edge). Authorisation is server-side: `protectedProcedure`/`adminProcedure` and the `/admin` page's own role check
