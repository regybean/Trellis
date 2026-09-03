# Mounting `@acme/db`

The one connection factory. Features import it rather than declaring a database
connection of their own, so an app configures Postgres once and every mounted
package uses that configuration
([ADR 0016](../../../docs/adr/0016-db-connection-platform-package.md)).

## What it gives you

- `createDb()` — a configured query client. Features call it themselves; your
  app does not build one and pass it down.
- One place your Postgres connection is configured, so mounting a second
  table-owning feature adds no second connection setting.
- A shared column-naming convention, so tables defined in different packages
  land in one database consistently.

## Surface

| Import             | What's in it                                | Runs   |
| ------------------ | ------------------------------------------- | ------ |
| `@acme/db`         | `createDb()` and the naming convention      | server |
| `@acme/db/env`     | This package's env factory                  | either |
| `@acme/db/testing` | Test helpers that provision a real database | server |

## Wiring

- Compose `@acme/db/env` into your env composition —
  [env.md](../../../docs/mounting/env.md).
- Write your schema barrel and point your migration tool at it, then push or
  migrate before first boot — [schema.md](../../../docs/mounting/schema.md).
- Provide Postgres — [infra.md](../../../docs/mounting/infra.md).
- Don't call `createDb()` in your app to hand to a feature. Each feature calls
  it, which is what keeps a feature mountable without your app knowing it owns
  tables.

## Env

| Key           | Class  | What it's for                              |
| ------------- | ------ | ------------------------------------------ |
| `DB_PASSWORD` | secret | The Postgres password your deploy provides |

Plus four profile-authored connection keys — host, port, user and database name
— which have working local values and are each overridable by an environment
variable of the same name. See `src/env.ts`.

## Infra

`postgres`. Required whenever this package is in the graph; nothing prunes it.
