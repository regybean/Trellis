# Shared Auth (`@acme/auth`)

The auth seam. **Mid-migration:** Clerk is still what the apps run on, and Better
Auth's self-hosted server half now sits beside it. Both surfaces are live in this
package until #218 finishes moving the apps over and deletes the Clerk one. See
[ADR 0033](../../../docs/adr/0033-better-auth-replaces-clerk.md) for the
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
_Avoid_: "the auth client" (that is `createAuthClient`, app-owned, and does not
exist yet), "the auth singleton"

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
([ADR 0034](../../../docs/adr/0034-auth-tables-in-a-dedicated-schema.md)).
Prefixed `auth*` so `user`/`session` don't collide in a consumer's imports.
`authTables` is the unprefixed model→table map the Drizzle adapter needs.
_Avoid_: "the auth schema" for the Drizzle module (it means the Postgres schema
`authSchema`)

**A session is a row.** Better Auth resolves every request by reading `session`;
`initAuth` turns the cookie cache off explicitly so that stays true. Deleting the
row revokes the session immediately — the backend suite asserts it.
_Avoid_: "session claims", "JWT claims" — Clerk vocabulary with no Better Auth
equivalent. Role lives on the **user row** (`authUser.role`), not in a token.

**`authEnv()`** (`@acme/auth/env`):
`BETTER_AUTH_SECRET` plus, for now, `CLERK_SECRET_KEY`. Built on
`@t3-oss/env-core`, not `env-nextjs` — a shared-layer package must not carry a
framework dependency, and there are no `NEXT_PUBLIC_*` client vars here to need
the Next flavour. Composed only by the two _full_ apps; the `*-slim` apps mount no
auth ([ADR 0010](../../../docs/adr/0010-slim-no-auth-apps.md)).

**`authConfig(context)`** (`@acme/auth/config`):
Clerk's config-as-code — route URLs and publishable key per deploy profile
(ADR 0026). Goes with the Clerk half.

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
  the route handler and the sign-in/up pages belong to the app (#218).
