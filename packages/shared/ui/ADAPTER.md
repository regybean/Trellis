# Mounting `@acme/ui`

The component library every feature's UI is built from. Mounting it is mostly a
build-tool concern: tell Tailwind where the components live, import the token
surface, and mount the providers the stateful ones need
([ui.md](../../../docs/mounting/ui.md)).

## What it gives you

- The primitive set — buttons, inputs, dialogs, tables, tabs, sidebars and the
  rest — that feature components already use, so a mounted feature looks like
  your app rather than like a different one.
- A token surface you override to re-theme every shared and feature component at
  once, without touching a component.
- Composed widgets above the primitives: markdown rendering, a message input, a
  search bar, sign-in and sign-up forms, a user button.
- Theme and toast providers, plus the hooks that read them.
- `cn`, the class-merging helper feature components use.

## Surface

| Import     | What's in it                         | Runs   |
| ---------- | ------------------------------------ | ------ |
| `@acme/ui` | Primitives, widgets, providers, `cn` | client |

One entry point, no server subpath: this package renders and nothing else.

## Wiring

- Add the package sources to Tailwind's scan list in your style entrypoint. Miss
  this and components render with correct markup and no styling at all —
  [ui.md](../../../docs/mounting/ui.md).
- Import the shared theme, then override tokens after it if you want to diverge.
- Mount the theme and toast providers in your provider tree —
  [provider.md](../../../docs/mounting/provider.md). An unmounted toast
  container makes every toast call succeed and display nothing.
- Assemble your own shell and chrome from these pieces. Navigation and layout
  are app-owned
  ([ADR 0011](../../../docs/adr/0011-remove-compositions-layer.md)).
- The auth-shaped widgets take their signed-in state as a prop, so an app with
  no auth mounts them by passing a constant.
