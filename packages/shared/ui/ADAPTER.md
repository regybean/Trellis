# Mounting `@acme/ui`

The components are plain imports. The mounting work is **CSS build wiring** plus
three providers, and the CSS half is the part that silently half-works: import
the components without the `@source` globs and they render unstyled, because
Tailwind never scans the package for the classes they use.

## Mounted by

All four apps — `src/app/styles.css` (or `src/styles.css`),
`postcss.config.js`, `components.json`, and the root layout / `__root` route.

## Glue

### 1. Tailwind must scan the packages — `apps/nextjs/src/app/styles.css`

```css
@import 'tailwindcss';
@import 'tw-animate-css';
@import '@acme/tailwind-config/theme';

@source '../../../../packages/shared/*/src/**/*.{ts,tsx}';
@source '../../../../packages/features/*/src/**/*.{ts,tsx}';
@source '../components/**/*.{ts,tsx}';
```

The `@source` lines are the mounting. Tailwind v4 scans the app's own tree by
default; a workspace package is outside it, so without these the utility classes
`@acme/ui` (and every feature) uses are never generated. Paths are relative to
this CSS file — check the depth if your app sits somewhere else.

### 2. PostCSS — `apps/nextjs/postcss.config.js`

```js
export { default } from '@acme/tailwind-config/postcss-config';
```

One line, re-exported rather than re-authored.

### 3. The token surface, and how to diverge from it

`@acme/tailwind-config/theme` ships the shared token set. An app overrides the
same CSS variables to get a different identity without touching a single
component:

```css
/*
 * Divergent editorial token surface. The shared theme ships a light-first
 * Montserrat / blue look; this app overrides the same tokens into a warm
 * "print magazine" identity … Feature components are untouched: they read these
 * tokens and re-skin automatically. Mirrors how tanstack-start diverges to its
 * console look, proving the slice contract holds — same routes, different skin.
 */
:root {
  --background: oklch(0.9711 0.013 83);
  --foreground: oklch(0.231 0.012 55);
  …
}
```

Compare `apps/nextjs/src/app/styles.css` against
`apps/tanstack-start/src/styles.css` to see the range this buys.

### 4. The providers — `apps/nextjs/src/app/layout.tsx`

```tsx
import { NextThemeProvider, ToastThemeClient, TooltipProvider } from '@acme/ui';

<NextThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
>
  …
  <TooltipProvider>
    <EditorialShell>
      <ToastThemeClient />
      {props.children}
    </EditorialShell>
  </TooltipProvider>
</NextThemeProvider>;
```

- `NextThemeProvider` — wraps `next-themes`. An app that wants one fixed theme
  passes `forcedTheme` instead (`apps/tanstack-start` locks dark).
- `TooltipProvider` — required by any component using tooltips; mount once.
- `ToastThemeClient` — the app's single `<ToastContainer />`, theme-aware and
  client-rendered so it can read `localStorage`. **Every** toast in the repo
  lands here: `@acme/hooks`' error handler, `@acme/notifications`' default
  renderer, and the features' own. Omit it and toasts silently go nowhere.

### 5. Sidebar shell (optional) — `apps/nextjs-slim/src/app/layout.tsx`

```tsx
<SidebarProvider>
  <Sidebar />
  <SidebarInset className="flex h-svh flex-col overflow-hidden">
```

`SidebarInset` alone is `min-w-0 flex-1` — a flex-row item with no height — so a
`flex-1` / `h-full` page has nothing concrete to resolve against and collapses to
content height. Making the inset a real full-height flex column is what fixes it.
Shell and chrome are app-owned (ADR 0011), so this lives in the app, not here.

### 6. shadcn CLI wiring — `apps/nextjs/components.json`

```json
{
  "tailwind": { "config": "", "css": "./src/app/styles.css" },
  "aliases": { "utils": "@acme/ui", "components": "src/", "ui": "src/ui" }
}
```

`utils` points at this package so a CLI-generated component imports `cn` from
`@acme/ui` rather than creating a second copy.

### 7. Auth-shaped components without auth

`SignInForm`, `SignUpForm` and `UserButton` are here rather than in
`@acme/auth`, and they take their data as props (`UserButtonUser`). That is what
keeps `better-auth` out of the substrate — the app feeds them from its own
client.

## Env

Factory: none. `@acme/ui` reads no environment.

## Infra

None — no `acme.infra`.

## Also mount

Nothing from `@acme/*` at runtime; `@acme/tailwind-config` (a `tooling` package)
is a devDependency of the app and supplies the theme and PostCSS config above.
`react`, `react-dom` and `react-toastify` are the app's peers.
