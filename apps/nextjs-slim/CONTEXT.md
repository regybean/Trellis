# App (`apps/nextjs-slim`)

A slim Next.js application: a copy of `apps/nextjs` with **all auth and billing
(Stripe) stripped out**. It wires only the `@acme/chat` and `@acme/ingest`
feature slices into a single-user, no-login product. Owns no business logic — it is
the integration layer. Runs on port 3002.

It exists to prove the platform seams (the framework-agnostic auth seam, ADR 0003,
and the entitlements injection seam, ADR 0006) actually decouple the features from
the auth provider and Stripe: a deployment can drop both and still run.

## Language

**Constant principal** (`src/server/trpc-route.ts`):
The fixed `InjectedSession` this app injects in place of a resolved session —
`{ user: { id: 'local', role: 'admin' } }`. The features still require a principal
(`@acme/chat` is `protectedProcedure`; `@acme/ingest` is `adminProcedure`), so the
app supplies one constant admin user rather than resolving auth. Nothing behind it
resolves a provider, which is the point: the platform's session type names none. See
[ADR 0010](../../docs/adr/0010-slim-no-auth-apps.md).
_Avoid_: "fake user", "mock auth".

**Unlimited entitlements**:
`unlimitedEntitlements` from `@acme/entitlements` — the no-billing entitlements
provider (top tier, infinite credits, no-op consume) injected in place of the
Stripe/Redis-backed `subscriptionsEntitlements`. This app needs it because it
mounts `@acme/chat`, which meters credits: "unmetered" is a choice the deployment
has to make, not a default it can omit. It reaches only the chat mount —
`@acme/ingest` declares no entitlements on its context and is handed none (#256).
See [ADR 0006](../../docs/adr/0006-entitlements-injection-seam.md).

**Route handler**:
A Next.js `route.ts` that bridges a feature's tRPC router to
`/api/trpc/{feature}/[trpc]`. Two builders in `src/server/trpc-route.ts`, one per
context shape this app composes: `createTRPCRouteHandlers` injects the constant
principal, and `createTRPCRouteHandlersWithEntitlements` adds
`unlimitedEntitlements` for the one mount whose feature declares it. A mount
wired to the wrong one does not compile.

## Structure

| Path                                      | Purpose                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `app/chat-assistant/`                     | Chat UI page — renders `ChatAssistant` from `@acme/chat`                  |
| `app/documents/`                          | Documents page — renders `@acme/ingest` upload UI + list                  |
| `app/api/trpc/chat/[trpc]/`               | Route handler for `@acme/chat` router                                     |
| `app/api/trpc/ingest/[trpc]/`             | Route handler for `@acme/ingest` router                                   |
| `app/api/health/`                         | Health check endpoint                                                     |
| `src/server/trpc-route.ts`                | Two route-handler builders — constant principal, ± unlimited entitlements |
| `src/components/pages/layout/sidebar.tsx` | App-local minimal sidebar (app-owned shell, ADR 0011)                     |

## Relationships

- Each feature's `TRPCProvider` wraps its page(s) and points to its
  `/api/trpc/{feature}` endpoint.
- `AppQueryClientProvider` (root `layout.tsx`) mounts the app's **one**
  `QueryClient`, above every feature provider. The feature providers above are
  tRPC providers — they render no `QueryClientProvider` of their own and read
  this one from context ([ADR 0036](../../docs/adr/0036-one-app-owned-query-client.md)).
- No auth middleware, no `@acme/auth`, `@acme/billing`, or `@acme/subscriptions`.
- `instrumentation.ts` initialises OpenTelemetry (`trellis-nextjs-slim`) at startup.
- `db/schema.ts` exports only `appSchema` (no app-owned tables); `db:push` owns the
  per-app `CREATE SCHEMA` that Mastra's memory + vector store need at runtime.
- A distinct indigo/violet primary accent visually distinguishes it from
  `apps/tanstack-slim` (amber).
