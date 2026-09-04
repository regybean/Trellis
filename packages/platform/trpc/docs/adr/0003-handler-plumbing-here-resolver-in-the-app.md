# Handler plumbing lives here; the context resolver stays in the app

**Status:** accepted

The fetch-adapter wiring, `logTRPCError` and the CORS policy are substrate, not
auth. They live in `@acme/trpc/handler` as `createTRPCFetchHandler` so they
can't drift per-app. They had drifted: one app hand-rolled `console.error` and
never depended on `@acme/trpc` at all; another omitted the `OPTIONS` handler.
`corsPreflightHeaders` is the single source of the CORS policy.

Only the **Context resolver** stays app-owned, because it _is_ the
auth-and-framework-specific part: it maps the app's auth provider session onto
the neutral `InjectedSession`. Keeping it in the app is what satisfies the
framework-agnostic auth seam
([ADR 0003](../../../../../docs/adr/0003-framework-agnostic-auth-seam.md)) and
lets the slim apps drop the auth provider entirely
([ADR 0010](../../../../../docs/adr/0010-slim-no-auth-apps.md)).

The split is measured by what a fifth framework would have to write: one
resolver, not a whole handler.

## Consequences

- `createTRPCFetchHandler({ endpoint, router, resolver })` pins the resolver's
  return type to the router's own context, so a mount handed a resolver that
  doesn't build what the feature reads fails to compile.
- Apps compose the returned handler into their framework's handler shape.
- The 204 preflight `Response` is built at each app's `OPTIONS` seam, not here.
  The `Response` global is framework-runtime-provided (Next vs TanStack/Nitro)
  and crosses a Node-vs-DOM type boundary if constructed in a platform package.
  The headers still come from here; only the construction is app-side.
