# Slim apps are separate no-auth deployments that inject a constant principal

**Status:** accepted

The auth seam ([@acme/auth ADR 0003](../../../packages/shared/auth/docs/adr/0003-framework-agnostic-auth-seam.md)) and the
entitlements seam ([@acme/entitlements ADR 0001](../../../packages/platform/entitlements/docs/adr/0001-entitlements-injection-seam.md)) made the
caller's identity and billing policy _injected_ values: the platform substrate
(`@acme/trpc`) imports no Clerk SDK and no Stripe/Redis implementation. The
entitlements seam named the motivating case — "a single-user `nextjs-slim` app". This ADR records
how that app (and its TanStack Start twin) is actually built.

Two questions had non-obvious answers.

## How a no-auth app satisfies procedures that require a principal

Stripping Clerk does not remove the features' need for a principal. The retained
features still gate on one:

- `@acme/chat` — every procedure is `protectedProcedure`; it scopes Mastra memory
  by a **non-null** `userId`.
- `@acme/ingest` — every procedure is `protectedProcedure`, and owner-scoped: a
  Data Source and the Documents in it belong to a `userId`, which is also what
  every retrieval filter is built from.

So a no-auth app cannot inject "signed out" (`{ user: null }`) — chat would
reject every call and ingest would have no owner to scope to. Instead each slim
app injects a single **constant principal** at its tRPC route seam:

```ts
const LOCAL_SESSION: InjectedSession = {
  user: { id: "local" },
};
// inject: { headers, req, session: LOCAL_SESSION, entitlements: unlimitedEntitlements }
```

The principal carries **nothing but the id**, because nothing retained reads
anything else. There is deliberately no `role`: it used to say `'admin'`,
invented to satisfy an `adminProcedure` gate on ingest that no longer exists, and
a role here would now be a claim about an authorization model this app does not
have. Entitlements are `unlimitedEntitlements` from `@acme/entitlements`.

> Updated by #220: the seam was `{ auth: InjectedAuth, user }` when this ADR was
> written — a Clerk-shaped `{ userId, sessionClaims }` pair plus a separate
> `ctx.user`. It is now the single neutral `InjectedSession`
> ([@acme/auth ADR 0003](../../../packages/shared/auth/docs/adr/0003-framework-agnostic-auth-seam.md), amendment). The decision is
> unchanged; only the shape being injected is.

> This ADR used to reject **a non-admin constant principal (`role: 'user'`)** on
> the grounds that ingest's `adminProcedure` would 403 it, while upload and list
> are core to the slim product. That trade-off no longer exists: ingest dropped
> the role gate for owner scoping, so the option was resolved by removing the
> gate rather than by choosing a role. It is kept here as a note because the
> reasoning is the reason the paragraph above reads the way it does.

The surprising consequence is no longer a privilege escalation. It is that **the
slim subset reduces a security property to a tautology.**

The features these apps mount now carry a real privacy boundary: a Data Source
belongs to an owner, and every retrieval filter is built from the verified
`userId` rather than from anything in the request. Here that `userId` is a
constant. Every visitor to a slim deployment is `local`, so every Data Source
belongs to all of them, and the boundary is satisfied **vacuously** — not because
the scoping works, but because there is only ever one owner to scope to.

That is the correct behaviour for a single-tenant local product, and it is worth
being precise about what it costs. **The slim apps prove nothing about the
privacy boundary.** They exercise the code path and can never exercise the
property, so a regression that collapsed owner scoping entirely would run green
in both of them. The full apps are where the invariant is actually tested.

No test can flag this, which is why it lives here. Apps are `testClass: app` and
are covered only through their features' suites, so there is no slim-app test to
write that would notice a constant owner — and a feature test, run against real
distinct users, sees a boundary that works.

## Separate apps, not a runtime no-auth flag on the full apps

The slim variants are **copies** (`apps/nextjs-slim`, `apps/tanstack-slim`), not a
`AUTH_DISABLED` branch inside `apps/nextjs` / `apps/tanstack-start`.

A runtime flag would keep `@clerk/*`, `@acme/billing`, `@acme/subscriptions`, and
`@acme/admin` in the dependency graph and `ClerkProvider`/billing providers in the
tree — every `env.ts` would still demand Clerk + Stripe keys, defeating the point
(a no-Clerk, no-Stripe deployment). It also forks every auth-touching file into
two live code paths guarded by a boolean, which is exactly the coupling the seams
were built to remove. Separate apps keep each deployment's dependency graph honest:
the slim apps simply don't depend on auth/billing packages, so the seam is enforced
by the build, not by a runtime branch.

The cost is duplicated app shell/config across the two pairs. That duplication is
deliberate — the feature slices and platform packages (where the logic lives) stay
single-sourced; only the thin integration layer is copied.

## Considered and rejected

- **A runtime `AUTH_DISABLED` flag on the full apps.** Rejected — keeps Clerk +
  Stripe in the dependency graph and env surface, and forks auth-touching files
  into boolean-guarded dual paths. The seam should be enforced by the build.
- **Injecting a signed-out context (`{ userId: null }`).** Rejected — both
  retained features are `protectedProcedure` and need a non-null principal to
  scope by. A constant principal is required.
- **Sharing one `localPrincipal` helper across both apps.** Rejected (for now) —
  each app already owns its tRPC route seam (the Next.js route handler vs. the
  TanStack server handler), so the constant lives next to its injection point, an
  app-local concern. A shared helper would be a new cross-app coupling for four
  lines.
- **Keeping a minimal drizzle layer vs. dropping it.** Kept. Dropping `@acme/feedback`
  removes the only app-owned table, but the per-app Postgres schema (named off
  `NEXT_PUBLIC_WEBAPP`) must still exist at runtime for Mastra's memory + vector
  store. `db/schema.ts` exports only `appSchema`, so `db:push` owns the
  `CREATE SCHEMA` ([@acme/rag ADR 0001](../../../packages/shared/rag/docs/adr/0001-mastra-rag-and-memory.md)). Relying on Mastra's
  defensive `CREATE SCHEMA IF NOT EXISTS` as the primary creator was rejected as
  unreliable.

## Amendment — the client-side half: no `AuthStatusProvider` means always-authorized

Everything above is server-side: what the route seam injects. The browser needs
the same answer, and it is reached differently — by **absence**.

`@acme/hooks` owns the client status seam. `useAuthStatus()` throws when no
`AuthStatusProvider` is mounted, because a full app failing to mount one is a
wiring bug. But `useOptionalAuthStatus()` returns `null`, and a client seam that
gates on it must read `null` as **authorized, not signed-out** — the slim apps
mount no provider at all, so `null` is their steady state, not a transient.

`@acme/notifications` is the case that fixes the convention:
`shouldTailNotifications(status)` returns `status === null || status.isSignedIn`.
The `isSignedIn` arm exists so a full app doesn't subscribe to a
`protectedProcedure` while signed out and earn a retried `UNAUTHORIZED`; the
`null` arm exists so the slim apps still stream.

Recorded because reversing it is silent in exactly the way the constant principal
is. Treating `null` as signed-out compiles, and leaves every gated client seam in
both slim apps permanently dark while the full apps stay green — the mirror image
of injecting `{ user: null }` server-side, and rejected for the same reason.
