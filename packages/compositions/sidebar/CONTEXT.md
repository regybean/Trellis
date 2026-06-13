# Sidebar (`@acme/sidebar`)

Reusable collapsible sidebar composition. Provides the shell navigation chrome — header, main nav, help links, and user menu — without owning any domain logic or data fetching.

## Language

**Nav item**:
A single entry in the main navigation menu. Has a `title`, `url`, optional `icon`, optional nested `items`, and optional `customContent` for arbitrary React nodes.
_Avoid_: "menu item", "link", "route"

**App sidebar**:
The top-level collapsible container exported by this package. Accepts `header`, `navMain`, and renders `NavUser` (the Clerk-aware user menu with subscription badge).

## Relationships

- `AppSidebar` composes `NavHeader` + `NavMain` + `NavHelp` + `NavUser`
- `NavUser` imports `NavUserSubscription` from `@acme/billing` to show the user's current Subscription tier inline
- Callers supply all nav items — this package has no knowledge of specific routes

## Design decisions

**No data fetching**: The sidebar is pure presentational composition. Route definitions live in the apps; feature-specific content (like subscription status) is delegated to the relevant feature package (`@acme/billing`).
