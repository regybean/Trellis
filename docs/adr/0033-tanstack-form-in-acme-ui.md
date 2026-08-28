# TanStack Form is the form library, and `@acme/ui` is where it lands

The auth widgets (`SignInForm`, `SignUpForm`) manage their fields with
[TanStack Form](https://tanstack.com/form) rather than hand-rolled state, and
`@tanstack/react-form` is a runtime `dependency` of `@acme/ui`. Any future form
in shared UI or in a feature uses the same library.

## The cost, named first

`@acme/ui` is the widest-fanout package in the graph. All four apps import it,
including both `*-slim` builds, so a dependency here is a mandatory dependency
for every app whether or not it renders a form. The immediate need was two flat
credential forms, and uncontrolled inputs plus `new FormData(event.currentTarget)`
through the existing zod schema already covered those with no dependency at all.

That cost is real and it is being paid deliberately. What buys it is that forms
are not going to stay at two. The auth epic alone implies password reset and
profile editing, and without a shared library each one re-derives its own
validate, submit, and render-the-messages shape. Standardising when the second
form appears is cheaper than standardising after the fifth.

## Why TanStack Form and not React Hook Form

**Headless, so the slice contract holds.** It ships no framework-specific entry
point, so a form behaves the same under Next and TanStack Start and `@acme/ui`
stays runtime-agnostic. That is the constraint letting apps mount different
subsets.

**Standard Schema, so zod stays the source of truth.** The schemas in
`lib/auth-credentials.ts` go straight to `validators.onSubmit`. No resolver
package, no second copy of the messages. React Hook Form would add
`@hookform/resolvers`, a second dependency on the same widest-fanout package.

**Controlled by default.** `@acme/ui` is built on Radix primitives, which are
controlled components. React Hook Form's uncontrolled-ref model fights them and
forces `Controller` wrappers around exactly the fields most likely to need one.

**Already in the repo's toolkit.** TanStack Query and TanStack Start are both
here.

## What it does not change

The forms stay presentational and prop-driven. `onSubmit`, `error` and `pending`
are still the caller's, so `@acme/ui` takes no `@acme/auth` dependency and the
slim apps' graph gains no auth or billing code
([ADR 0010](0010-slim-no-auth-apps.md)). TanStack Form owns field state and
validation timing, nothing else. The caller still owns the provider call and
still owns clearing `error`.

The swap was invisible to the tests. All 17 existing cases passed unchanged
across the rewrite, because they assert rendered DOM rather than form internals
([ADR 0018](0018-frontend-test-doctrine.md)). That is the evidence the seam sits
in the right place, and the reason a future swap stays cheap.

## Consequences

- `@tanstack/react-form` is in the workspace catalog and is a hard runtime
  dependency of every app.
- New forms use it. A form that hand-rolls `useState` per field is a review
  finding, not a style preference.
- `firstErrorMessage` in `lib/auth-credentials.ts` narrows TanStack's
  union-typed `meta.errors` structurally. That array is typed as the union of
  every validator slot a field could carry, so the narrowing is required by the
  types rather than working around them.
