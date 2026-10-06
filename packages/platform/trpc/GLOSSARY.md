# Platform tRPC (`@acme/trpc`)

The single source of the tRPC runtime config and request-pipeline middleware that
every feature reuses. It owns _how_ a request is authenticated, traced and timed
— not _what_ any feature does with it. It builds no tRPC instance of its own, and
gates on nothing billing-related.

## Language

**Feature tRPC**:
The per-feature tRPC instance (router, procedures, context) a feature creates in
its own `api/trpc.ts` with `initTRPC.context<FeatureContext>().create(trpcConfig)`.
Each feature has exactly one, and composes the shared middleware onto it in four
one-line `t.middleware` calls.
_Avoid_: "the tRPC setup", "the router config"

**Base context**:
The neutral half of the request context every procedure receives — the request
plus the app-injected `session` (`BaseContext`). Assembling it does no I/O. It
carries no `telemetry`, no billing state and no `db`.
_Avoid_: "the request object", "the tRPC context object"

**Feature context**:
The whole of one feature's request context — a `BaseContext` the feature extends
with whatever else its procedures read, named in that feature's `api/trpc.ts` and
handed to `initTRPC.context<…>()`. `@acme/billing`'s `BillingContext` and
`@acme/chat`'s `ChatContext` both add `{ entitlements: EntitlementsProvider }`;
`@acme/feedback`, `@acme/ingest` and `@acme/notifications` add nothing, so theirs
is `BaseContext` under a feature-local name.
_Avoid_: "the context extension", "the custom context", "extra ctx fields"

**Entitlements provider**:
The `EntitlementsProvider` (`@acme/entitlements`) a feature that meters or gates
names on its **Feature context**, reaching `ctx.entitlements` — the billing seam.
The full apps inject `@acme/subscriptions`'s `subscriptionsEntitlements`
(Stripe/Redis-backed); a no-billing build injects `unlimitedEntitlements`. This
package names neither the implementation nor the contract — it doesn't depend on
`@acme/entitlements` at all.
_Avoid_: "the billing service", "the subscription client"

**Entitlements resolution**:
The `subscription` / `tier` / `credits` triple a procedure gets by calling
`ctx.entitlements.resolve(userId)` on the injected **Entitlements provider**.
Performed by the procedures that read it — billing's tier gate and account
router, chat's `send` and `reconcileTurn` — never by the substrate.
_Avoid_: "the billing context" — nothing assembles one up front.

**Injected session**:
The `InjectedSession` an app resolves at its edge and puts on the context it
builds — `{ user: InjectedUser | null }`. `InjectedUser` is a concrete exported
interface, `{ id, role?, email? }`: the gates read `id` and `role`; `email` is
optional, present because `@acme/billing` opens a Stripe customer against it and
absent in the slim apps, which inject a constant principal and drop billing. No
auth provider is named here — mapping a provider's session onto this shape is the
app's job.
_Avoid_: "the auth object", "the provider session"

**Protected procedure**:
A procedure requiring a principal — `requirePrincipal` rejects a null
`ctx.session.user` and the middleware re-injects the narrowed session, so
downstream `ctx.session.user` is non-null.

**Admin procedure**:
A procedure requiring `ctx.session.user.role === 'admin'` (`requireAdmin`). An
admin implies a principal, so this narrows `ctx.session.user` too.

**Context resolver**:
The app-owned function that turns an HTTP `Request` into a **Feature context**,
mapping its auth provider's session onto the **Injected session** (a resolved
Better Auth session for the full apps; a constant local principal for the slim
apps). Each app exports one per context shape it can build — `resolveContext` and
`resolveContextWithEntitlements` — and each mount names the one it needs. It is
the only per-app, per-framework piece of the route seam.
_Avoid_: "the auth handler", "the context builder"

**tRPC route handler factory** (`@acme/trpc/handler`):
`createTRPCFetchHandler({ endpoint, router, resolver })` — the framework-parametric
fetch-adapter wiring (with `logTRPCError` baked in) every app shares. The
resolver's return type is pinned to the router's own context, so a mount handed a
resolver that doesn't build what the feature reads fails to compile. Apps compose
the result into their framework's handler shape. `corsPreflightHeaders` is the
single source of the CORS policy; the trivial 204 `Response` is built at each
app's `OPTIONS` seam.

## Relationships

- A **Feature tRPC** is created by the feature, from this package's `trpcConfig`
  plus its own **Feature context** type
- The four middleware bodies — `withProcedureSpan`, `withTimingLog`,
  `requirePrincipal`, `requireAdmin` — live here as plain functions with no tRPC
  types in them; each feature wraps them in `t.middleware` and stacks them
- Each body takes only what it logs or decides on: `withTimingLog` reads
  `NODE_ENV` itself rather than taking an `isDev` flag
- Every procedure receives its feature's **Feature context**, whole — there is no
  merge step and nothing the substrate adds
- **Admin procedure** and **Protected procedure** build on a public procedure
  (telemetry + timing middleware) that each feature keeps unexported — every
  procedure in the tree today is gated, so the base is a local, not a surface
- The telemetry middleware creates and _activates_ the per-procedure span; the
  other middlewares emit their events through the active span read ambiently via
  `trace.getActiveSpan()`, not through `ctx`
- A procedure that meters or gates on billing performs its own **Entitlements
  resolution**. No middleware here does
- `@acme/trpc/testing` supplies the test caller context, built from the same
  `BaseContext` an app's **Context resolver** returns

## Decisions

See [`docs/adr/`](docs/adr/).
