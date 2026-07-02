# Framework-agnostic admin user widgets belong in `@acme/ui`, not duplicated per app

[ADR 0011](0011-remove-compositions-layer.md) deleted the `@acme/admin` composition
and folded its components back into the two consuming apps, because those
components coupled to a specific auth provider and framework: `AdminDashboard`
called `auth()` from `@clerk/nextjs/server`, and `SearchUsers` used
`useRouter`/`usePathname`/`useSearchParams` from `next/navigation`. A component
that can't cross the Next.js / TanStack Start boundary isn't reusable, so folding
it into the apps was correct.

That reasoning does **not** apply to two of the folded pieces. After the fold,
`apps/nextjs/src/components/admin/user-management.tsx` and
`user-detailed-management.tsx` were **byte-identical** to their
`apps/tanstack-start/src/components/admin/` counterparts, and the duplication was
pure — the same source lived in two apps with no per-app divergence.

## The deletion test

ADR 0011 itself blesses the escape hatch: "If two apps share a UI assembly, the
right move is to extract the stateless presentational piece into `@acme/ui`." The
test for whether a component qualifies is: **does it import anything framework- or
router-specific?**

- `user-management.tsx` — imports `react` (`useState`), `lucide-react`, `@acme/ui`
  primitives, and `SerializableUser` (a type) from `@acme/auth`. No `next/*`, no
  `@tanstack/*`, no router hooks, no server-only calls. Role mutations arrive as
  `(FormData) => Promise<void>` props — the app owns the framework binding.
- `user-detailed-management.tsx` — same, plus it rendered `RateLimitManagement` /
  `TierManagement` from `@acme/billing`.

Both pass the deletion test on framework coupling. They are the "stateless
presentational piece" 0011 names.

## Why this does not reopen wholesale composition

This promotes exactly two leaf presentational components into a **shared package**
(`@acme/ui`), not a new `packages/compositions/` entry. It changes nothing about
0011's core ruling: shell/chrome (`AdminDashboard`, `SearchUsers`, server actions)
stays app-owned. `AdminDashboard` still lives in each app and still supplies the
framework-specific mutations. Creating a new composition package would still
require its own ADR.

## Keeping `@acme/ui` in the `shared` layer honest

Two couplings had to be kept out of `@acme/ui` (a `shared` package that may only
depend on `shared`/`platform`/`tooling`, and that the **slim apps depend on** —
ADR 0010 requires the slim graph carry no `@acme/auth`/`@acme/billing`):

- **`@acme/billing` (a `feature`)** — `shared` cannot depend on `feature`, and the
  slim apps must not gain billing. So `UserDetailedManagement` no longer imports
  billing; it accepts an optional `billingPanels: ReactNode` prop.
  `UserManagement` forwards it via `renderBillingPanels?: (user) => ReactNode`.
  Each full app injects `<RateLimitManagement /> + <TierManagement />`; a slim app
  could reuse the same widget with no billing at all.
- **`@acme/auth`'s `SerializableUser` type** — importing it would force `@acme/ui`
  to declare `@acme/auth` as a dependency, pulling auth into the slim graph. Instead
  `@acme/ui` declares a structurally-identical `UserManagementUser` interface it
  owns. Apps keep passing `SerializableUser` (assignable by structure); no new
  package edge is created.

The net effect: `@acme/ui` gains two widgets and **zero new package dependencies**;
the billing/auth coupling stays at the app seam where 0011 wants it.

## What was done

- Added `UserManagement` + `UserDetailedManagement` (and the `UserManagementUser`
  type) to `packages/shared/ui/src/widgets/`, exported from `@acme/ui`.
- Deleted the four duplicated files under `apps/nextjs/src/components/admin/` and
  `apps/tanstack-start/src/components/admin/`.
- Both apps' `AdminDashboard` now import `UserManagement` from `@acme/ui` and pass
  `renderBillingPanels`.

## Status

accepted — refines [ADR 0011](0011-remove-compositions-layer.md) for these two
files only.

## Considered and rejected

- **Leave the two files duplicated per app.** Rejected — byte-identical, purely
  presentational, framework-free. This is the exact case 0011's escape hatch names;
  keeping the copies is the navigability cost 0011 set out to reduce.
- **Move them to a new `packages/compositions/` entry.** Rejected — 0011 requires a
  dedicated ADR justifying why an assembly can't live in an app or `@acme/ui`. It
  can live in `@acme/ui`, so it does.
- **Import `SerializableUser` from `@acme/auth` in `@acme/ui`.** Rejected — adds an
  `@acme/auth` edge to a package the slim apps depend on, re-coupling the slim graph
  to auth (against ADR 0010). A UI-owned structural type avoids the edge.
- **Import `@acme/billing` panels directly in `@acme/ui`.** Rejected — `shared`
  cannot depend on `feature`, and it would drag billing into the slim graph. Inject
  via prop instead.
