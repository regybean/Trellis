# Compositions layer removed — shell/chrome is always app-owned

**Status:** accepted

The compositions layer (`packages/compositions/`) was introduced as a home for
cross-app reuse of UI assemblies that depended on more than one feature package.
Two packages were ever written: `@acme/sidebar` and `@acme/admin`.

In practice neither delivered reuse. The framework-coupling issue the auth seam
was written to solve — a package resolving the session itself, and so binding to
one framework's server SDK — meant the reduced apps and the second framework
could not consume them:

- `@acme/sidebar` — `NavUser` hardcodes Clerk's Next.js SDK and `@acme/billing`;
  `NavHeader`/`NavMain` use `next/image` and `next/link`. All four apps built
  their own shells without importing it. Zero production consumers at deletion.
- `@acme/admin` — `AdminDashboard` calls `auth()` from Clerk's Next.js server
  SDK; `SearchUsers` calls `useRouter`/`usePathname`/`useSearchParams` from
  `next/navigation`. The Next.js app consumed it fully; the TanStack Start app
  overrode `SearchUsers` and the server actions with app-owned equivalents and
  only kept `UserManagement`. The reduced apps dropped it entirely.

The reuse claim was illusory: components that couple to a specific auth provider
and a specific framework cannot cross the Next.js / TanStack Start boundary that
the reduced apps make explicit. The "cross-app DRY" lived only in the one
Next.js → `@acme/admin` edge; TanStack Start had already duplicated the logic
that mattered.

## What was done

`@acme/sidebar` was deleted outright. `@acme/admin` was deleted after its
components were folded into the two consuming apps:

- The Next.js app — `AdminDashboard`, `SearchUsers`, `UserManagement`,
  `UserDetailedManagement`, and server actions (`setRole`/`removeRole`) moved
  to `src/components/admin/` + `src/lib/admin.ts`, mirroring the layout the
  TanStack Start app had already established.
- The TanStack Start app — `UserManagement` + `UserDetailedManagement` moved
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

The escape hatch was later applied: the two admin user widgets folded in here
turned out to be byte-identical and framework-free, so they were promoted into
`@acme/ui`. That refines this ADR for those two files; it does not reopen
wholesale composition.

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
  Rejected — `@acme/auth` already owns the role vocabulary, and both apps
  include its globals. The role guard inlines to a single read, as the TanStack
  Start app's `src/lib/admin.ts` already does. (At the time that read
  was `sessionClaims?.metadata.role !== 'admin'` against Clerk's
  `CustomJwtSessionClaims`; the auth seam has since collapsed that to
  `readRole(await auth()) !== 'admin'` — same claim, parsed in one place, and the
  auth package's own ADRs record the change.)
