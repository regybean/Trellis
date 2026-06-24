# Slim apps are separate no-auth deployments that inject a constant admin principal

The auth seam ([ADR 0003](0003-framework-agnostic-auth-seam.md)) and the
entitlements seam ([ADR 0006](0006-entitlements-injection-seam.md)) made the
caller's identity and billing policy *injected* values: the platform substrate
(`@acme/trpc`) imports no Clerk SDK and no Stripe/Redis implementation. ADR 0006
named the motivating case — "a single-user `nextjs-slim` app". This ADR records
how that app (and its TanStack Start twin) is actually built.

Two questions had non-obvious answers.

## How a no-auth app satisfies procedures that require a principal

Stripping Clerk does not remove the features' need for a principal. The retained
features still gate on one:

- `@acme/chat` — every procedure is `protectedProcedure`; it scopes Mastra memory
  by a **non-null** `userId`.
- `@acme/ingest` — every procedure is `adminProcedure`; it gates on
  `sessionClaims.metadata.role === 'admin'`.

So a no-auth app cannot inject "signed out" (`{ userId: null }`) — chat would
reject every call and ingest would 403. Instead each slim app injects a single
**constant principal** at its tRPC route seam:

```ts
const LOCAL_PRINCIPAL: InjectedAuth = {
  userId: 'local',
  sessionClaims: { metadata: { role: 'admin' } },
};
// inject: { headers, req, auth: LOCAL_PRINCIPAL, user: null, entitlements: unlimitedEntitlements }
```

The `role: 'admin'` is **load-bearing, not cosmetic**: it is the only reason
`@acme/ingest`'s `adminProcedure` admits the caller. `ctx.user` is `null` because
no retained feature reads it (only `@acme/billing`, which is dropped, did).
Entitlements are `unlimitedEntitlements` from `@acme/entitlements` (ADR 0006).

The surprising consequence — **a no-auth app injects `role: 'admin'`** — is the
thing this ADR exists to make legible. It reads like a privilege escalation; it
is actually "there is one local user and they own this single-tenant deployment."

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

## Status

accepted

## Considered and rejected

- **A runtime `AUTH_DISABLED` flag on the full apps.** Rejected — keeps Clerk +
  Stripe in the dependency graph and env surface, and forks auth-touching files
  into boolean-guarded dual paths. The seam should be enforced by the build.
- **Injecting a signed-out context (`{ userId: null }`).** Rejected — `@acme/chat`
  (`protectedProcedure`) and `@acme/ingest` (`adminProcedure`) reject it. A
  constant principal is required.
- **A non-admin constant principal (`role: 'user'`).** Rejected — `@acme/ingest`'s
  `adminProcedure` would 403, and documents (upload/list) are core to the slim
  product. The single local user owns the deployment, so `admin` is correct.
- **Sharing one `localPrincipal` helper across both apps.** Rejected (for now) —
  each app already owns its tRPC route seam (the Next.js route handler vs. the
  TanStack server handler), so the constant lives next to its injection point, an
  app-local concern. A shared helper would be a new cross-app coupling for four
  lines.
- **Keeping a minimal drizzle layer vs. dropping it.** Kept. Dropping `@acme/feedback`
  removes the only app-owned table, but the per-app Postgres schema (named off
  `NEXT_PUBLIC_WEBAPP`) must still exist at runtime for Mastra's memory + vector
  store. `db/schema.ts` exports only `appSchema`, so `db:push` owns the
  `CREATE SCHEMA` ([ADR 0002](0002-mastra-rag-and-memory.md)). Relying on Mastra's
  defensive `CREATE SCHEMA IF NOT EXISTS` as the primary creator was rejected as
  unreliable.
