# Shared Auth (`@acme/auth`)

The auth seam. **Mid-migration:** `apps/tanstack-start` runs on Better Auth
(#224); `apps/nextjs` is still on Clerk until #223. Both surfaces are therefore
live in this package until #226 deletes the Clerk one — which is also why
`authEnv()` still demands `CLERK_SECRET_KEY` from every full app, including the
one with no Clerk code left in it. See
[ADR 0034](../../../docs/adr/0034-better-auth-replaces-clerk.md) for the
replacement decision and
[ADR 0003](../../../docs/adr/0003-framework-agnostic-auth-seam.md) for the seam
the Clerk half was built on.

## Language

**`initAuth({ baseUrl, trustedOrigins })`** (`@acme/auth/server`):
Builds _the app's_ Better Auth instance — email/password provider, sessions in
Postgres, admin plugin. A factory, not a module singleton: `baseUrl` differs per
app (each runs on its own port) and a shared-layer package must not read app env.
The **secret is not a parameter** — `BETTER_AUTH_SECRET` is slice-owned, declared
and validated in `./env`.
_Avoid_: "the auth client" (that is `createAuthClient`, app-owned — see
`apps/nextjs/src/lib/auth-client.ts` and its TanStack Start twin), "the auth
singleton"

**`Auth` / `Session`** (`@acme/auth/server`):
The instance type and `{ session, user }` as Better Auth resolves it. `Session`'s
`user` is intersected with the admin plugin's `UserWithRole`, because Better
Auth's own `$Infer` does not widen `user` with plugin schema fields even though
the row carries them.

**`authUser` / `authSession` / `authAccount` / `authVerification`**
(`@acme/auth/schema`):
Better Auth's four tables as Drizzle tables, hand-authored in **`pgSchema('auth')`**
— a constant schema, not the per-app `NEXT_PUBLIC_WEBAPP` one, because identity
is shared across the apps on one database
([ADR 0035](../../../docs/adr/0035-auth-tables-in-a-dedicated-schema.md)).
Prefixed `auth*` so `user`/`session` don't collide in a consumer's imports.
`authTables` is the unprefixed model→table map the Drizzle adapter needs.
_Avoid_: "the auth schema" for the Drizzle module (it means the Postgres schema
`authSchema`)

**`toPrincipal(session)` / `readSessionRole(user)`** (`@acme/auth/server`):
The Better Auth → `InjectedUser` mapping, and the validated read of the role off
the user row. Shared by both full apps deliberately: _resolving_ a session is
framework-specific and app-owned (a TanStack Start server function vs. Next.js
middleware), but the mapping is **provider**-specific, and `primaryEmailAddress`
has to agree exactly with `@acme/billing`'s augmentation of `InjectedUser` — two
declarations of one merged member must match, so it is built once here.
Both are typed **structurally**, on the fields they read, not against `Session`:
Better Auth types `getSession` as returning the core columns only, so its result
is not assignable to `Session` (whose `UserWithRole` intersection requires the
plugin's fields). That is also why the role is _parsed_ rather than read as a
property — it is a runtime fact with no static promise behind it. Supersedes
`toInjectedPrincipal` + `readRole`, which go with the Clerk half in #226.
_Avoid_: "read the role claim" — there is no token to decode; role is a column.

**A session is a row.** Better Auth resolves every request by reading `session`;
`initAuth` turns the cookie cache off explicitly so that stays true. Deleting the
row revokes the session immediately — the backend suite asserts it.
_Avoid_: "session claims", "JWT claims" — Clerk vocabulary with no Better Auth
equivalent. Role lives on the **user row** (`authUser.role`), not in a token.

**`betterAuthEnv()`** (`@acme/auth/env`):
Better Auth's own two variables, and nothing else: `BETTER_AUTH_SECRET` (signs
session cookies) and `BETTER_AUTH_URL` (the origin auth routes are served from).
Neither is profile-authored — the secret because it is a secret, the URL because
it is per-app (each app binds its own `PORT`) and per-deploy. `initAuth` reads
this, so standing up an instance never requires a Clerk key. Built on
`@t3-oss/env-core`, not `env-nextjs` — a shared-layer package must not carry a
framework dependency. Composed by `apps/nextjs`; the `*-slim` apps mount no auth
([ADR 0010](../../../docs/adr/0010-slim-no-auth-apps.md)).

**`authEnv()`** (`@acme/auth/env`):
The **Clerk** composition, and the last of it: `clerkWiringEnv()` +
`betterAuthEnv()` + `CLERK_SECRET_KEY`. Since #223 only `apps/tanstack-start`
composes it — `apps/nextjs` moved to `betterAuthEnv()`. Retires with Clerk.

**`clerkWiringEnv()`** (`@acme/auth/env`):
Clerk's browser-safe wiring — the four route URLs and the publishable key,
authored as profile defaults per deploy target and read without a secret in the
call. `authEnv()` extends it, and `apps/tanstack-start` reads it directly for
`<ClerkProvider>`. Goes with the Clerk half.

## Relationships

- **Auth is now stateful, so this package depends on `@acme/db`.** `initAuth`
  builds its adapter over `createDb()`. Under Clerk this package touched no
  database at all.
- **DDL is app-owned, as for every other table.** The apps re-export the four
  tables from `src/server/db/schema.ts` and list `auth` in their
  `drizzle.config.ts` `schemaFilter`; `db:push` owns the DDL. This package
  defines the columns and decides nothing about migration
  ([ADR 0021](../../../docs/adr/0021-test-schema-provisioning-db-push.md)).
- **The app owns the client and the chrome.** Better Auth ships no UI, so unlike
  the Clerk half this package exports no React components. `createAuthClient`,
  the route handler and the sign-in/up pages belong to the app —
  `apps/tanstack-start` is the first one wired that way (#224); `apps/nextjs`
  follows in #223.
