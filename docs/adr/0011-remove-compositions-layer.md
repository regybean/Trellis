# Compositions layer removed — shell/chrome is always app-owned

**Status:** accepted

The compositions layer (`packages/compositions/`) was introduced as a home for
cross-app reuse of UI assemblies that depended on more than one feature package.
Two packages were ever written. Both were deleted, and the layer with them.

Neither delivered reuse, and the reason generalises past the two: **a UI assembly
that resolves the session itself binds to one framework's server SDK and one auth
provider.** That is the same coupling the auth seam was written to remove from the
substrate, reappearing a layer up. A composition built that way cannot cross a
framework boundary, and it cannot be consumed by a deployment that has no auth
provider at all — so it is consumable by exactly the app it was extracted from.

The evidence was blunt. One of the two had zero consumers at deletion: every app
had built its own shell rather than import it. The other had one full consumer;
a second app on a different framework had already overridden the framework-bound
half with app-owned equivalents and kept only the framework-free remainder. The
"cross-app DRY" lived in a single edge, and the duplication it was meant to
prevent had already happened.

The specifics — which packages, which components moved where — are app-layer
history and are recorded under `apps/docs/adr/`, which the bank never
distributes. Nothing here depends on reading them.

## What was done

Both packages were deleted, their components folded into the apps that consumed
them.

The `composition` turbo boundary tag was **renamed to `app`** — not deleted.
Every app carried `"tags": ["composition"]`, and `feature.dependents.allow:
["composition"]` was the rule permitting app→feature imports. There was never a
separate `app` tag; apps and the two composition packages shared one. Deleting
the tag would have made every app→feature/shared/platform import a boundary
violation. Renaming preserves the rules under an honest name.
`packages/compositions/` no longer exists.

## Canonical pattern going forward

Shell/chrome is **always app-owned**. If two apps share a UI assembly, the right
move is to extract the stateless presentational piece into `@acme/ui` (a shared
package) — not to create a new composition that will accumulate framework
coupling. A new `packages/compositions/` entry requires an explicit ADR
justifying why the assembly genuinely cannot live in an app or in `@acme/ui`.

The escape hatch was later applied: two of the admin user widgets folded in here
turned out to be byte-identical across apps and framework-free, so they were
promoted into `@acme/ui`. That refines this ADR for those two files; it does not
reopen wholesale composition.

## Considered and rejected

- **Extract the nav components to `@acme/ui` before deleting.** Rejected — the
  reduced apps already build equivalent nav in ~25 lines from raw `@acme/ui`
  primitives. Adding a new `@acme/ui` export for zero current consumers is
  premature abstraction.
- **Keep the admin composition, scoped to its one framework.** Rejected — it was
  already partially overridden on the second framework, which proves the
  abstraction leaks. A composition that requires per-app overrides is not a
  composition, and a framework-scoped package in a shared layer is an app in the
  wrong directory.
- **Keep the tag named `composition`.** Rejected — the apps would stay labelled
  for a layer that no longer exists, the exact navigability problem this cleanup
  targets. Renaming to `app` makes the tag match the layer diagram.
- **Keep the composition's role-guard indirection when folding in.** Rejected —
  `@acme/auth` already owns the role vocabulary, and every app includes its
  globals. The guard inlines to a single read. The provider-specific claim
  parsing it wrapped has since collapsed into the auth seam, and the auth
  package's own ADRs record that change.
