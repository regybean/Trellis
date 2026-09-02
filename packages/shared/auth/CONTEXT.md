# Shared Auth (`@acme/auth`)

The auth seam, and after #239 it is Better Auth end to end: both full apps run on
it, and the package's client barrel is gone. What remains is the **server** half
— the instance and the mappings — plus the signing secret. See
[ADR 0034](../../../docs/adr/0034-self-hosted-better-auth.md) for the
replacement decision and
[ADR 0003](../../../docs/adr/0003-framework-agnostic-auth-seam.md) (with its two
amendments) for the seam.

The package ships **no React**. Better Auth ships no UI, so `@acme/ui` owns the forms,
`@acme/hooks` owns the client status seam, and the app owns `createAuthClient`.

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

**`readSessionRole(user)` / `toPrincipal(session)` / `toAdminUser(user)`**
(`@acme/auth/server`):
The three provider→neutral mappings: the validated read of the role off a user
row, the Better Auth → `InjectedUser` mapping for the tRPC context, and the
Better Auth user → `@acme/ui` admin-widget row.

Shared by both full apps deliberately, and #239 is why it is worth restating: the
two migration PRs ran in parallel and each wrote its own copy of all three.
_Resolving_ a session is framework-specific and app-owned (a TanStack Start
server function vs. Next.js middleware plus a route handler); the mapping is
**provider**-specific and both full apps need the identical answer, so it is
built once here. `toPrincipal` returns `@acme/trpc`'s exported `InjectedUser`
directly — a plain `{ id, role?, email? }`. Before #250 it wrapped the email back
into Clerk's nested primary-address object for billing to unwrap again, kept in
step by two hand-synced global augmentations.

All three are typed **structurally**, on the fields they read, not against
`Session`: Better Auth types `getSession` as returning the core columns only, so
its result is not assignable to `Session` (whose `UserWithRole` intersection
requires the plugin's fields). That is also why the role is _parsed_ rather than
read as a property — it is a runtime fact with no static promise behind it.
`readSessionRole` takes a user **row**, not `unknown`: the `unknown` version
accepted a whole resolved session, failed its parse silently, and degraded every
caller to non-admin with no error anywhere.
_Avoid_: "read the role claim" — there is no token to decode; role is a column.

**A session is a row.** Better Auth resolves every request by reading `session`;
`initAuth` turns the cookie cache off explicitly so that stays true. Deleting the
row revokes the session immediately — the backend suite asserts it.
_Avoid_: "session claims", "JWT claims" — there is no Better Auth equivalent.
Role lives on the **user row** (`authUser.role`), not in a token.

**`betterAuthEnv()`** (`@acme/auth/env`):
`BETTER_AUTH_SECRET`, and nothing else — the one key this slice actually reads
(`initAuth` pulls the secret out of it). No profile authors it, because it is a
secret. Built on `@t3-oss/env-core`, not `env-nextjs` — a shared-layer package
must not carry a framework dependency. Composed by both full apps; the `*-slim`
apps mount no auth ([ADR 0010](../../../docs/adr/0010-slim-no-auth-apps.md)).

**`BETTER_AUTH_URL` is not here** — each app authors it in its own `createEnv`,
with a profile default per app (`:3000` / `:3001`). #239 settled it: both
migration branches declared the key, in different places. The slice cannot hold a
value that differs per app and cannot default one, which is the same fact
`initAuth` already encodes by taking `baseUrl` as a parameter.
_Avoid_: "the auth URL is slice config"

## Relationships

- **Auth is now stateful, so this package depends on `@acme/db`.** `initAuth`
  builds its adapter over `createDb()`. Before the sessions-as-rows move
  (ADR 0034) this package touched no database at all.
- **DDL is app-owned, as for every other table.** The apps re-export the four
  tables from `src/server/db/schema.ts` and list `auth` in their
  `drizzle.config.ts` `schemaFilter`; `db:push` owns the DDL. This package
  defines the columns and decides nothing about migration
  ([ADR 0021](../../../docs/adr/0021-test-schema-provisioning-db-push.md)).
- **It type-imports `@acme/ui`**, for `UserManagementUser` — the row shape
  `toAdminUser` returns. `shared` → `shared` is a legal edge and the import
  is erased at runtime; the direction is what matters, because the reverse
  (`@acme/ui` importing `@acme/auth`) would drag auth into the slim apps' graph
  ([ADR 0013](../../../docs/adr/0013-admin-user-widgets-to-ui.md)).
- **The app owns the client and the chrome.** `createAuthClient`, the
  `/api/auth` route mount, the sign-in/up pages and the route guards belong to
  the app. The client-side _status_ seam features read is `@acme/hooks`'
  `useAuthStatus`, not anything here — this package ships no React, so it could
  not carry it even if the layering allowed.
- **The seam is lint-enforced.** `banBetterAuth` in `tooling/eslint/base.ts`
  fails a runtime `better-auth` import everywhere except this package and the two
  full apps.
