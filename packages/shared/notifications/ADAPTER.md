# Mounting `@acme/notifications`

One delivery path from server-side work to a signed-in user's screen. Features
publish; your app mounts the router and the provider that renders what arrives
([ADR 0030](../../../docs/adr/0030-notifications-seam.md)).

## What it gives you

- `publish` — the call a feature or a background job makes to notify a user,
  with no knowledge of how it will be displayed.
- A tRPC router and provider that stream notifications to the browser, so a job
  that finishes minutes after the request can still reach the user who started
  it.
- A default toast renderer, plus a renderer map you override per notification
  type when a toast is not what you want.
- Delivery that survives a reload: notifications are queued per user rather than
  pushed at a live connection only.

## Surface

| Import                       | What's in it                       | Runs   |
| ---------------------------- | ---------------------------------- | ------ |
| `@acme/notifications`        | The provider, renderers, dispatch  | client |
| `@acme/notifications/server` | Router, context factory, `publish` | server |
| `@acme/notifications/schema` | The notification shape             | client |
| `@acme/notifications/env`    | This package's env factory         | either |

## Wiring

- Mount the router at a path of your choosing —
  [trpc-route.md](../../../docs/mounting/trpc-route.md).
- Mount the provider in your provider tree, above anything that should be able
  to raise a notification — [provider.md](../../../docs/mounting/provider.md).
- Mount a toast container too, if you use the default renderer. Without one,
  publishing succeeds and nothing appears —
  [ui.md](../../../docs/mounting/ui.md).
- Pass renderers only for the types you want to display differently. Anything
  unmapped falls back to the default.
- Compose the env factory and provide Redis —
  [env.md](../../../docs/mounting/env.md),
  [infra.md](../../../docs/mounting/infra.md).
- Publishing is for features and jobs, not for your app's own UI. Client-side
  feedback about a click is a toast, raised directly.

## Env

All four keys are profile-authored config: the notification retention window and
the reader's poll backoff bounds, plus the environment selector. Each is
overridable by an environment variable of the same name. See `src/env.ts`.

## Infra

`redis`. Notifications are queued there per user, which is what makes delivery
survive a reload.
