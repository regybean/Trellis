# The credit balance display belongs to billing, its placement to the app

**Status:** accepted

Shell and chrome are app-owned in this repo, and a shared user-menu composition
was already deleted once for hardcoding an auth provider's widget alongside this
package's modal. Exporting a component that an app drops into its profile menu
therefore needs saying out loud rather than being inferred: `@acme/billing` owns
the credit balance display, its number formatting, its Tier label and its
loading and error states, because each of those is this package's domain
language. Each app owns where that component sits.

The line is content against placement. Two apps render the same balance, and if
each formatted its own, the pair drifts. A reader looking at two different
numbers then has no way to tell which app is wrong.

## Considered options

**Each app reads `account.getCreditUsage` and renders its own row.** Rejected.
This package exports no hook, so every app would either need a new export anyway
or reach through `useTRPC` into a procedure it does not own, and the formatting
rules would then exist in as many copies as there are apps.

**A shared composition owning the whole menu.** Rejected, and already tried
once. The deleted version bundled an auth provider's widget with this package's
modal, so an app could not take the credit display without also taking the menu
around it.
