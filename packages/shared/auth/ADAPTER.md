# Mounting `@acme/auth`

Identity, behind a seam. Your app builds the instance, mounts its routes and
maps its user onto the neutral principal features read
([ADR 0003](../../../docs/adr/0003-framework-agnostic-auth-seam.md)). No feature
imports this package.

## What it gives you

- `initAuth` — builds a configured auth instance for your app. It takes the
  origin as a parameter, because each app is served from its own and a shared
  package cannot know it.
- A framework-agnostic handler you mount at a catch-all path, so sign-in,
  sign-up, sessions and callbacks are one route file.
- `toPrincipal` — maps a session onto the neutral principal your route seam
  injects, which is what keeps features from importing an auth provider.
- Identity tables you re-export from your schema barrel, in their own Postgres
  schema so several apps on one database share their users
  ([ADR 0002](docs/adr/0002-auth-tables-in-a-dedicated-schema.md)).

## Surface

| Import              | What's in it                           | Runs   |
| ------------------- | -------------------------------------- | ------ |
| `@acme/auth/server` | `initAuth`, the handler, `toPrincipal` | server |
| `@acme/auth/schema` | The identity tables                    | client |
| `@acme/auth/env`    | This package's env factory             | either |

There is no client subpath. The browser client is built in your app from the
auth library directly, because it is same-origin and needs no shared wrapper.

## Wiring

- Build the instance once in your app, passing your origin.
- Mount the handler at a catch-all route, and match the path your browser client
  expects.
- Map the session in your route seam and inject the principal —
  [trpc-route.md](../../../docs/mounting/trpc-route.md).
- Re-export the identity tables from your schema barrel, and let your migration
  tool manage their schema —
  [schema.md](../../../docs/mounting/schema.md).
- Gate your own routes yourself. Procedures are gated by the injected principal;
  which pages require a session is your app's decision.
- Resolve the session on the server where you need it on first render — a
  client-side read arrives too late for anything that depends on it.

## Env

| Key                  | Class  | What it's for                           |
| -------------------- | ------ | --------------------------------------- |
| `BETTER_AUTH_SECRET` | secret | Signs sessions; your deploy provides it |

The origin the routes are mounted on is **not** here. It is app-owned, so it
belongs in your env composition — [env.md](../../../docs/mounting/env.md).

## Infra

`postgres`. Identity is stored in the same database as your app's tables, in its
own schema.
