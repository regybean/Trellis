# Compositions layer removed — shell/chrome is always app-owned

The compositions layer (`packages/compositions/`) was introduced as a home for
cross-app reuse of UI assemblies that depended on more than one feature package.
Two packages were ever written: `@acme/sidebar` and `@acme/admin`.

In practice neither delivered reuse. The framework-coupling issue ([ADR 0003](0003-framework-agnostic-auth-seam.md))
meant the slim apps and TanStack Start could not consume them:

- `@acme/sidebar` — `NavUser` hardcodes `@clerk/nextjs` and `@acme/billing`;
  `NavHeader`/`NavMain` use `next/image` and `next/link`. All four apps built
  their own shells without importing it. Zero production consumers at deletion.
- `@acme/admin` — `AdminDashboard` calls `auth()` from `@clerk/nextjs/server`;
  `SearchUsers` calls `useRouter`/`usePathname`/`useSearchParams` from
  `next/navigation`. `apps/nextjs` consumed it fully; `apps/tanstack-start`
  overrode `SearchUsers` and the server actions with app-owned equivalents and
  only kept `UserManagement`. Slim apps dropped it entirely.

The reuse claim was illusory: components that couple to a specific auth provider
and a specific framework cannot cross the Next.js / TanStack Start boundary that
the slim-app ADR (ADR 0010) makes explicit. The "cross-app DRY" lived only in the
`apps/nextjs` → `@acme/admin` edge; TanStack Start had already duplicated the
logic that mattered.

## What was done

`@acme/sidebar` was deleted outright. `@acme/admin` was deleted after its
components were folded into the two consuming apps:

- `apps/nextjs` — `AdminDashboard`, `SearchUsers`, `UserManagement`,
  `UserDetailedManagement`, and server actions (`setRole`/`removeRole`) moved
  to `src/components/admin/` + `src/lib/admin.ts`, mirroring the layout
  `apps/tanstack-start` had already established.
- `apps/tanstack-start` — `UserManagement` + `UserDetailedManagement` moved
  to `src/components/admin/`; `SearchUsers` and server functions were already
  app-owned.

The `composition` turbo boundary tag was **renamed to `app`** — not deleted. All
four apps carried `"tags": ["composition"]`, and `feature.dependents.allow:
["composition"]` was the rule permitting app→feature imports. There was never a
separate `app` tag; apps and the two composition packages shared one. Deleting
the tag would have made every app→feature/shared/platform import a boundary
violation. Renaming preserves the rules under an honest name. `packages/compositions/`
no longer exists.

## Canonical pattern going forward

Shell/chrome is **always app-owned**. If two apps share a UI assembly, the right
move is to extract the stateless presentational piece into `@acme/ui` (a shared
package) — not to create a new composition that will accumulate framework coupling.
A new `packages/compositions/` entry requires an explicit ADR justifying why the
assembly genuinely cannot live in an app or in `@acme/ui`.

## Status

accepted

## Considered and rejected

- **Extract `NavMain`/`NavHeader` to `@acme/ui` before deleting `@acme/sidebar`.**
  Rejected — both slim apps already build equivalent nav in ~25 lines from raw
  `@acme/ui` primitives. Adding a new `@acme/ui` export for zero current consumers
  is premature abstraction.
- **Keep `@acme/admin` as a Next.js-only composition.** Rejected — it is already
  partially overridden in TanStack Start, which proves the abstraction leaks. A
  composition that requires per-app overrides is not a composition.
- **Keep the tag named `composition`.** Rejected — the apps would stay labelled
  for a layer that no longer exists, the exact navigability problem this cleanup
  targets. Renaming to `app` makes the tag match the layer diagram.
- **Keep admin's `global.d.ts` / `checkRole` indirection when folding in.**
  Rejected — `@acme/auth` already exports `Roles` and augments
  `CustomJwtSessionClaims.metadata.role` (both apps include it). The role guard
  inlines to `sessionClaims?.metadata.role !== 'admin'`, as
  `apps/tanstack-start/src/lib/admin.ts` already does.
