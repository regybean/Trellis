# Better Auth replaces Clerk, self-hosted, with sessions in Postgres

Auth was Clerk: an external identity service, `@acme/auth` a wrapper around it
(the client barrel re-exports `@clerk/clerk-react`'s prebuilt components behind
`'use client'`; the server half maps `@clerk/backend`'s `User` to a serializable
shape). Clerk reaches 86 code files and 26 docs.

It becomes **Better Auth, self-hosted, no external identity provider**. The
server instance lives in `@acme/auth/server` as `initAuth(options)` — a factory,
not a module singleton, because `baseUrl` differs per app and a shared-layer
package must not read app env. `@acme/auth/schema` holds the four tables
(`user`, `session`, `account`, `verification`) as Drizzle tables;
`@acme/auth/env` demands `BETTER_AUTH_SECRET`.

## Why

Two reasons, in order of weight.

**It removes the largest divergence from the AIA fork.** `platform/trpc` and
`shared/auth` are the two files AIA and Trellis both edited most (424 and 386
changed lines), and both diverged for the same reason: AIA swapped Clerk for
Better Auth and recorded it in its ADR 0031. Converging removes most of the
conflict surface before the first full sync, including the five Clerk catalog
entries AIA has already deleted. The design is proven in a sibling repo rather
than speculative.

**It makes auth a seam the template can actually swap.** Clerk was named as a
replaceable provider "behind a seam" ([ADR 0003](../../../../../docs/adr/0003-framework-agnostic-auth-seam.md)),
but the seam only covered _resolution_ — the session _type_ in `@acme/trpc` was
Clerk's shape (`userId` + `sessionClaims`), and `CustomJwtSessionClaims` was
declared in seven places. A starter whose auth cannot be self-hosted is a
starter with a mandatory vendor.

## Three consequences worth naming

**Auth becomes stateful.** Clerk sessions were external and stateless to us;
Better Auth sessions are rows in `session`, resolved by a database read on every
request. `initAuth` therefore sets `session.cookieCache.enabled: false`
explicitly. That is Better Auth's default, but it is set anyway because it is
load-bearing rather than a tuning knob: with the cookie cache on, a deleted or
revoked session keeps resolving until the cached cookie expires, and "delete the
row, the session is gone" stops being true. The backend suite asserts exactly
that — delete the row, and the byte-for-byte identical cookie resolves to null.

**`@acme/auth` gains a `@acme/db` dependency**, and the auth tables come under
app-owned `db:push`/`db:migrate`. A shared-layer package now touches the
database; that is inherent to self-hosting identity, not an accident.

**Roles move from JWT claims to a column.** Better Auth has no equivalent of
Clerk's `CustomJwtSessionClaims`. The admin plugin puts `role` on the user row
(along with `banned`/`banReason`/`banExpires`), which is where the app's
`isAdmin` checks will read it.

## Status

accepted

## Considered and rejected

- **Keep Clerk.** Cheapest today, and it keeps the prebuilt sign-in/up UI that
  Better Auth does not ship. Rejected because it leaves the AIA divergence in the
  two hottest files and keeps a vendor mandatory in a template.
- **Keycloak, or any external identity provider.** AIA needs one; Trellis does
  not, and it would add an infra service to the local compose stack for no gain
  here. Rejected — out of scope, not wrong.
- **Copy AIA's implementation.** AIA's code is a reference to read, not content
  to import; back-flow from AIA is gated separately. Rejected.
- **A social provider alongside email/password.** Purely additive later: the
  `account` table already carries the OAuth columns, so adding one is config plus
  per-app client secrets. Deliberately not in the first ticket.

## Cost, honestly

Clerk's prebuilt components have no Better Auth equivalent. Sign-in, sign-up,
the user button and the admin user-management widget all need authoring against
`@acme/ui`, and `user-detailed-management.tsx` in particular reads Clerk's
`emailAddresses` array, `imageUrl`, `publicMetadata` and `lastSignInAt`. That UI
work, not the auth wiring, is the schedule risk in #218.

**How that landed (#225):** cheaper than feared, because the answer was
subtraction. The widgets were cut back to the columns Better Auth actually
stores rather than reproducing Clerk's shape, so `emailAddresses` /
`primaryEmailAddressId` collapsed to the single `email` that is the row's unique
key, and `lastSignInAt` was dropped rather than tracked — the core schema
records none, and inventing it meant writing session-history tracking to fill a
line of UI. See [@acme/ui ADR 0001](../../../ui/docs/adr/0001-admin-user-widgets-to-ui.md).

Existing Clerk users have no migration path. For a template repo that is
probably a non-issue, but any deployment with real users needs its own plan.

## Notes for the migration (#218)

- `@acme/auth` stops shipping React components. The `'use client'` directive in
  `index.ts` exists solely to stop the Next RSC graph evaluating
  `@clerk/shared` → `swr`; it goes with the dependency.
- The session type in `@acme/trpc` becomes `{ user: InjectedUser | null }`, so
  the provider is an app-side mapping. [ADR 0003](../../../../../docs/adr/0003-framework-agnostic-auth-seam.md)
  and [@acme/ui ADR 0001](../../../ui/docs/adr/0001-admin-user-widgets-to-ui.md) need updating for what the
  seam actually covers and for the user shape the admin widgets read.
- Both `*-slim` apps should come through untouched — a useful check that
  [ADR 0010](../../../../../docs/adr/0010-slim-no-auth-apps.md) holds.
