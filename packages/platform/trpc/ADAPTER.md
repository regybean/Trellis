# Mounting `@acme/trpc`

The transport every feature's router plugs into. Your app writes one route seam
using this package, and then one small route file per feature
([trpc-route.md](../../../docs/mounting/trpc-route.md)).

## What it gives you

- `createTRPCFetchHandler` — the fetch-adapter wiring, error logging and CORS
  policy, so your seam supplies only the framework shape and the context
  resolver. Your resolver is typechecked against the router you mount it under,
  so a mount that doesn't build what the feature reads won't compile.
- `BaseContext` — the neutral context a feature extends. What your resolver
  returns is the whole app-to-feature contract.
- `InjectedSession` — a neutral principal, so features read a user without
  importing your auth provider.
- `trpcConfig` plus `withProcedureSpan` / `withTimingLog` / `requirePrincipal` /
  `requireAdmin` — the pieces each feature builds its own tRPC instance from, so
  every procedure gets the same trace span, timing log and auth gates.
- Test-context construction that matches what the route handler builds, so
  procedure tests exercise the real contract.

## Surface

| Import               | What's in it                                      | Runs   |
| -------------------- | ------------------------------------------------- | ------ |
| `@acme/trpc`         | Context types, principal types, middleware pieces | server |
| `@acme/trpc/handler` | The fetch handler and CORS headers                | either |
| `@acme/trpc/testing` | The test-context builder                          | either |

`./handler` is separate from `.` because your route seam imports it from
framework code that may be bundled for either side, while `.` is server-only.

## Wiring

- Write the route seam once, then one route file per feature —
  [trpc-route.md](../../../docs/mounting/trpc-route.md).
- Resolve `session` and `entitlements` in the seam. Both are required with no
  default, so a deployment states whether it has auth and whether it meters.
- Construct the `Response` for the CORS preflight in your app, not here — the
  global belongs to your framework's runtime.
- Serve GET as well as POST. Streaming procedures arrive over GET, so a
  POST-only mount fails only on the streaming features.
- Mount each feature's client provider at the same path —
  [provider.md](../../../docs/mounting/provider.md).
