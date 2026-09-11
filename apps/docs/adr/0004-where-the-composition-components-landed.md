# Where the deleted composition components landed

**Status:** accepted

The repo-wide decision is
[docs/adr/0011-remove-compositions-layer.md](../../../docs/adr/0011-remove-compositions-layer.md):
the compositions layer is gone and shell/chrome is app-owned. That ADR carries
the rule. This one carries the part that is about _these_ apps — which packages
existed, what coupled them, and where each component ended up — because a
consumer's apps are their own and the bank never distributes `apps/`.

## The two packages

- **`@acme/sidebar`.** `NavUser` hardcoded Clerk's Next.js SDK and
  `@acme/billing`; `NavHeader` and `NavMain` used `next/image` and `next/link`.
  All four apps had built their own shells without importing it. Zero production
  consumers at deletion, so it was deleted outright with nothing to fold in.
- **`@acme/admin`.** `AdminDashboard` called `auth()` from Clerk's Next.js server
  SDK; `SearchUsers` called `useRouter` / `usePathname` / `useSearchParams` from
  `next/navigation`. The Next.js app consumed it fully. The TanStack Start app
  had already overridden `SearchUsers` and the server actions with app-owned
  equivalents and kept only `UserManagement`. The reduced apps dropped it
  entirely.

That asymmetry is the whole argument in miniature: the one edge that looked like
reuse was Next.js → `@acme/admin`, and the second framework had already
duplicated the logic that mattered.

## Where the components went

- **The Next.js app** — `AdminDashboard`, `SearchUsers`, `UserManagement`,
  `UserDetailedManagement`, and the `setRole` / `removeRole` server actions moved
  to `src/components/admin/` and `src/lib/admin.ts`, mirroring the layout the
  TanStack Start app had already established.
- **The TanStack Start app** — `UserManagement` and `UserDetailedManagement`
  moved to `src/components/admin/`. `SearchUsers` and its server functions were
  already app-owned and did not move.

`UserManagement` and `UserDetailedManagement` were later found to be
byte-identical across the two apps and free of framework imports, so they were
promoted into `@acme/ui`. That is the escape hatch the root ADR describes being
used as intended, on presentational components rather than on an assembly that
resolves a session.

## The role guard

At the time of the fold-in the guard read
`sessionClaims?.metadata.role !== 'admin'` against Clerk's
`CustomJwtSessionClaims`, and the TanStack Start app's `src/lib/admin.ts` already
inlined it that way. The auth seam has since collapsed that to
`readRole(await auth()) !== 'admin'` — the same claim, parsed in one place. The
auth package's own ADRs record that change; this note exists so the fold-in
diffs still read correctly against what was true when they were made.
