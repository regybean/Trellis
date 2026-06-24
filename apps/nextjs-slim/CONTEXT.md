# App (`apps/nextjs-slim`)

A slim Next.js application: a copy of `apps/nextjs` with **all auth (Clerk) and
billing (Stripe) stripped out**. It wires only the `@acme/chat` and `@acme/ingest`
feature slices into a single-user, no-login product. Owns no business logic — it is
the integration layer. Runs on port 3002.

It exists to prove the platform seams (the framework-agnostic auth seam, ADR 0003,
and the entitlements injection seam, ADR 0006) actually decouple the features from
Clerk and Stripe: a deployment can drop both and still run.

## Language

**Constant principal** (`src/server/trpc-route.ts`):
The fixed `InjectedAuth` this app injects in place of a resolved Clerk session —
`{ userId: 'local', sessionClaims: { metadata: { role: 'admin' } } }`. The features
still require a principal (`@acme/chat` is `protectedProcedure`; `@acme/ingest` is
`adminProcedure`), so the app supplies one constant admin user rather than resolving
auth. `ctx.user` is `null` — no retained feature reads it. See
[ADR 0010](../../docs/adr/0010-slim-no-auth-apps.md).
_Avoid_: "fake user", "mock auth".

**Unlimited entitlements**:
`unlimitedEntitlements` from `@acme/entitlements` — the no-billing entitlements
provider (top tier, infinite credits, no-op consume) injected in place of the
Stripe/Redis-backed `subscriptionsEntitlements`. See
[ADR 0006](../../docs/adr/0006-entitlements-injection-seam.md).

**Route handler**:
A Next.js `route.ts` that bridges a feature's tRPC router to
`/api/trpc/{feature}/[trpc]`. The shared `createTRPCRouteHandlers`
(`src/server/trpc-route.ts`) injects the constant principal + unlimited entitlements
for every feature mount.

## Structure

| Path                                      | Purpose                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `app/chat-assistant/`                     | Chat UI page — renders `ChatAssistant` from `@acme/chat`                       |
| `app/documents/`                          | Documents page — renders `@acme/ingest` upload UI + list                       |
| `app/api/trpc/chat/[trpc]/`               | Route handler for `@acme/chat` router                                          |
| `app/api/trpc/ingest/[trpc]/`             | Route handler for `@acme/ingest` router                                        |
| `app/api/health/`                         | Health check endpoint                                                          |
| `src/server/trpc-route.ts`                | Shared route handler — injects the constant principal + unlimited entitlements |
| `src/components/pages/layout/sidebar.tsx` | App-local minimal sidebar (no `@acme/sidebar`)                                 |

## Relationships

- Each feature's `TRPCReactProvider` wraps its page(s) and points to its
  `/api/trpc/{feature}` endpoint.
- No Clerk middleware, no `@acme/auth`, `@acme/billing`, `@acme/subscriptions`,
  `@acme/admin`, or `@acme/sidebar`.
- `instrumentation.ts` initialises OpenTelemetry (`trellis-nextjs-slim`) at startup.
- `db/schema.ts` exports only `appSchema` (no app-owned tables); `db:push` owns the
  per-app `CREATE SCHEMA` that Mastra's memory + vector store need at runtime.
- A distinct indigo/violet primary accent visually distinguishes it from
  `apps/tanstack-slim` (amber).
