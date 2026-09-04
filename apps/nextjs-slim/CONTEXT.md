# App (`apps/nextjs-slim`)

A slim Next.js application: a copy of `apps/nextjs` with **all auth and billing
(Stripe) stripped out**. It wires only the `@acme/chat` and `@acme/ingest`
feature slices into a single-user, no-login product. Owns no business logic — it is
the integration layer. Runs on port 3002.

It exists to prove the framework-agnostic auth seam and the entitlements
injection seam actually decouple the features from the auth provider and Stripe:
a deployment can drop both and still run.

## Language

**Constant principal** (`src/server/trpc-route.ts`):
The fixed `InjectedSession` this app injects in place of a resolved session —
`{ user: { id: 'local', role: 'admin' } }`. The features still require a principal
(`@acme/chat` is `protectedProcedure`; `@acme/ingest` is `adminProcedure`), so the
app supplies one constant admin user rather than resolving auth. Nothing behind it
resolves a provider: the platform's session type names none.
_Avoid_: "fake user", "mock auth".

**Unlimited entitlements** (`src/server/deps.ts`):
`unlimitedEntitlements` from `@acme/entitlements` — the no-billing entitlements
provider (top tier, infinite credits, no-op consume) injected in place of the
Stripe/Redis-backed `subscriptionsEntitlements`. This app needs it because it
mounts `@acme/chat`, which meters credits. It reaches only the chat mount —
`@acme/ingest` declares no entitlements on its context and is handed none.

**Route handler**:
A Next.js `route.ts` that bridges a feature's tRPC router to
`/api/trpc/{feature}/[trpc]`. Two builders in `src/server/trpc-route.ts`, one per
context shape this app composes: `createTRPCRouteHandlers` injects the constant
principal, and `createTRPCRouteHandlersWithEntitlements` adds the provider from
`src/server/deps.ts` for the one mount whose feature declares it. A mount wired
to the wrong one does not compile.

**Composition root** (`src/server/deps.ts`):
The one file where every implementation this app injects into a seam is
constructed, and both entry points — `src/server/trpc-route.ts` and `worker.ts` —
import the result. Lint keeps the providers out of every other file in this app.
For a slim app it is also where the absence of Stripe is _readable_ rather than
inferred from a missing dependency: one line choosing `unlimitedEntitlements`,
with `@acme/subscriptions` nowhere in it.

**Worker entrypoint** (`worker.ts`):
The generation + ingest worker's process entrypoint, and the second consumer of
the composition root alongside the route handlers.

## Relationships

- Each feature's `TRPCProvider` wraps its page(s) and points to its
  `/api/trpc/{feature}` endpoint.
- `AppQueryClientProvider` (root `layout.tsx`) mounts the app's **one**
  `QueryClient`, above every feature provider. The feature providers above are
  tRPC providers — they render no `QueryClientProvider` of their own and read
  this one from context.
- No auth middleware, no `@acme/auth`, `@acme/billing`, or `@acme/subscriptions`.
- The shell is app-owned: `src/components/pages/layout/sidebar.tsx` is an
  app-local minimal sidebar, not a shared assembly.
- `instrumentation.ts` initialises OpenTelemetry (`trellis-nextjs-slim`) at startup.
- `db/schema.ts` exports only `appSchema` (no app-owned tables); `db:push` owns the
  per-app `CREATE SCHEMA` that Mastra's memory + vector store need at runtime.
- A distinct indigo/violet primary accent visually distinguishes it from
  `apps/tanstack-slim` (amber).

## Decisions

See [`docs/adr/`](../../docs/adr/).
