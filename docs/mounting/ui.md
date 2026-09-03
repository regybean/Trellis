# Recipe: components, pages and styles

Packages ship React components. Getting them to render styled, on a page,
takes three things: Tailwind told where to look, the shared token surface
imported, and a page of yours that hosts the package's component.

## 1. Tailwind must scan the packages

Tailwind generates classes from the sources it scans. A component living in
`node_modules` (which a workspace package does, via a symlink) is not scanned by
default, so its classes are absent and it renders unstyled.

Add the package sources to your style entrypoint:

```css
@import "tailwindcss";
@import "@acme/tailwind-config/theme";

@source '<path to>/packages/shared/*/src/**/*.{ts,tsx}';
@source '<path to>/packages/features/*/src/**/*.{ts,tsx}';
```

The symptom of forgetting this is a component that appears with correct markup
and no styling at all.

## 2. The token surface

`@acme/tailwind-config/theme` defines the CSS custom properties every shared
component reads. Import it and components inherit a consistent look.

To diverge, override the same tokens after the import rather than restyling
components. Tokens are the seam; a component that hardcoded a colour could not
be re-themed by a consumer.

## 3. Providers

Shared UI that carries state — theming, toasts, sidebars — exports a provider.
Mount it in your provider tree ([provider.md](provider.md)). The package's
`ADAPTER.md` **Wiring** section names the ones it needs.

Toasts in particular need their container mounted, or calls to raise one succeed
silently and nothing appears.

## 4. Pages are yours

A feature exports components, not routes. Your app owns the URL, the layout
around it, and any framework-specific route configuration.

Some feature components need a value from the URL — a session id, a document id.
Your route captures it and passes it as a prop; the feature does not read your
router. Where a feature's component tree needs a slot filled by another feature,
it takes it as a render prop, and your page decides what goes there. That is
what keeps two features that appear together in your UI from depending on each
other.

## 5. Shell and chrome

Navigation, sidebars and the app shell belong to your app
([ADR 0011](../adr/0011-remove-compositions-layer.md)). `@acme/ui` provides the
pieces; assembling them into your product's chrome is yours.

## 6. Auth-shaped components without auth

Some shared components have a signed-in and a signed-out state. They take that
state as a prop rather than reading an auth provider, so an app with no auth at
all can still mount them by passing a constant.
