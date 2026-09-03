# Recipe: the schema barrel

A package that owns tables defines them but does not migrate them. Your app
does. The barrel is the module your migration tool reads, and re-exporting a
package's tables from it is how you say "this deployment manages these"
([@acme/db ADR 0001](../../packages/platform/db/docs/adr/0001-db-connection-platform-package.md)).

## 1. Re-export what you want managed

```ts
// Your app's schema barrel.
export { appSchema } from "./app-schema";
export { chatFolder } from "@acme/chat/schema";
export { messageFeedback } from "@acme/feedback/schema";
```

The package defines the columns; your app decides to manage them. Mount a
feature without re-exporting its tables and its procedures will fail at runtime
against a missing relation — the barrel is the step that is easy to forget.

A package's `./schema` subpath is client-safe: table definitions are values, not
a database connection, so importing one does not pull a driver into a bundle.

## 2. The per-app Postgres schema

App-owned tables live in a Postgres schema named after your app, so several apps
can share one database without colliding. Export the schema object itself from
the barrel too, so your migration tool owns its `CREATE SCHEMA`.

Identity tables are the exception — they sit in their own schema so that apps
sharing a database share their users
([@acme/auth ADR 0002](../../packages/shared/auth/docs/adr/0002-auth-tables-in-a-dedicated-schema.md)).

## 3. Tables you must not re-export

Some packages contain tables whose DDL belongs to a library that creates them at
runtime. Re-exporting those hands them to your migration tool, which then drops
them on the next push because it sees tables with no definition.

The package's `ADAPTER.md` says when this applies. The fix is a filter in your
migration config that excludes them by name pattern, and leaving them out of the
barrel. They stay queryable — a table does not have to be migration-managed to
be read with the same query builder.

## 4. Order of operations on a fresh database

1. Bring up Postgres ([infra.md](infra.md)).
2. Push or migrate your barrel, which creates the schemas and the tables.
3. Start the app, so any package that creates indexes at boot can reach a
   database that exists.

Migration commands are app-owned: they run from your app with your barrel and
your connection, not from a platform package.
