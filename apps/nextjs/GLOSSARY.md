# App (`apps/nextjs`)

The deployed Next.js application. Wires feature slices together into a runnable product and owns its shell/chrome + admin assembly. Owns no business logic — it is the integration layer.

## Language

**Route handler**:
A Next.js `route.ts` file that bridges a feature's tRPC router to an HTTP endpoint at `/api/trpc/{feature}/[trpc]`. Each feature has exactly one route handler in this app. The builders, and the context resolver each mount names, live in `src/server/trpc-route.ts`.
_Avoid_: "API route", "endpoint file"

**Composition root** (`src/server/deps.ts`):
The one file where every implementation this app injects into a seam is
constructed, and both entry points — `src/server/trpc-route.ts` and `worker.ts` —
import the result. Today that is the Stripe/Redis entitlements provider,
`createSubscriptionsEntitlements(toPlanIds(billingEnv))`. Lint keeps the
factories out of every other file in this app. Auth is the exception and stays in
the route seam: only one entry point resolves a principal.

**Auth catch-all** (`app/api/auth/[...all]/`):
The Better Auth catch-all handler. Every auth endpoint the browser calls sits
underneath it, and it is the only cookie writer in this app.

**Optimistic signed-in redirect** (`middleware.ts`):
The only thing middleware does here — a redirect on cookie _presence_, with no
validation and no database on the Edge. It exempts `/api/trpc`: a redirect is an
answer for a document request, not for a `fetch` that expects a tRPC error
envelope. Authorisation is server-side, in `protectedProcedure` /
`adminProcedure` and the `/admin` page's own role check.
_Avoid_: "auth middleware" — nothing is authorised here.

**Worker entrypoint** (`worker.ts`):
The generation + ingest worker's process entrypoint, and the second consumer of
the composition root alongside the route handlers.

## Relationships

- Each feature's `TRPCProvider` wraps its page(s) and points to its `/api/trpc/{feature}` endpoint
- `AppQueryClientProvider` (root `layout.tsx`) mounts the app's **one** `QueryClient`, above every feature provider. The `*TRPCProvider`s above are tRPC providers despite the name — they render no `QueryClientProvider` of their own and read this one from context
- `@acme/auth` ships the Better Auth instance factory and the tables, and no React at all; this app owns every framework-specific piece
- The mapping onto the neutral `InjectedUser` and the role read are **not** app-owned — `toPrincipal` / `readSessionRole` / `toAdminUser` live once in `@acme/auth/server`, shared with `apps/tanstack-start`. This app owns _resolution_ only. `role` is parsed, not asserted: it is an admin-plugin field Better Auth omits from `getSession`'s static type
- `@acme/hooks` owns the client status seam. `components/pages/layout/better-auth-status.tsx` publishes the neutral `AuthStatusProvider` that `@acme/billing` reads, seeded from the layout's server-resolved session
- `@acme/ui` owns the sign-in redirect rule: `?redirect=` goes through its `toSameSitePath`, so an off-site value lands on `/` instead of walking the visitor away the moment they authenticate
- `AdminDashboard` (app-owned, `components/admin/`) guards on the admin role inline via `auth.api.getSession`; the role mutation lives in `src/lib/admin.ts` as a server action
- `instrumentation.ts` initialises OpenTelemetry via `@acme/telemetry` at startup

## Decisions

See [`docs/adr/`](../../docs/adr/).
