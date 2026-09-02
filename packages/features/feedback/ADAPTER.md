# Mounting `@acme/feedback`

Per-message ratings. The smallest full slice in the repo, and the one worth
reading first to see what mounting a feature involves: a route, a provider, a
component and two tables.

## What it gives you

- A rating control you drop next to a generated message, with its own optimistic
  state and persistence.
- A hook for reading and writing a rating, if you want your own control instead.
- Two tables recording the rating and its target, which you re-export to have
  managed.
- A tRPC router and context factory to mount.

## Surface

| Import                  | What's in it                           | Runs   |
| ----------------------- | -------------------------------------- | ------ |
| `@acme/feedback`        | The rating control, the hook, provider | client |
| `@acme/feedback/server` | Router and context factory             | server |
| `@acme/feedback/schema` | The two tables                         | client |
| `@acme/feedback/env`    | This package's env factory             | either |

## Wiring

- Mount the router — [trpc-route.md](../../../docs/mounting/trpc-route.md).
- Mount the provider, passing a server-resolved `scopeKey` —
  [provider.md](../../../docs/mounting/provider.md).
- Re-export both tables from your schema barrel and push before first boot —
  [schema.md](../../../docs/mounting/schema.md).
- Place the control wherever your app renders a message. Where that message
  comes from another feature, that feature exposes a slot for it and your page
  decides what fills it — [ui.md](../../../docs/mounting/ui.md).
- Compose the env factory — [env.md](../../../docs/mounting/env.md).

## Env

| Key                  | Class  | What it's for       |
| -------------------- | ------ | ------------------- |
| `NEXT_PUBLIC_WEBAPP` | secret | Your app's identity |

No tunables and no secrets of its own beyond the selectors. See `src/env.ts`.

## Infra

`postgres` for the tables, `redis` transitively through the client substrate —
[infra.md](../../../docs/mounting/infra.md).
