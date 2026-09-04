# The test caller context lives in `@acme/trpc/testing`, and takes the session whole

**Status:** accepted

`createTestContext` (and `createMockSession`) live in this package, beside the
`BaseContext` they must match, so every feature builds a tRPC caller from the
real platform types. The alternative was a tooling package below `platform`,
which cannot import `BaseContext` and was therefore forced into a structural
`as any`.

`./testing` is a tree-shaken export subpath; production never imports it.

It takes whatever a feature's **Feature context** adds on top of `BaseContext`
and merges it the same way an app's context resolver does, so a test context
cannot drift from the one the route handler builds. The mock
`EntitlementsProvider` is deliberately _not_ here — it moved out with the
contract, to `@acme/entitlements/testing`, so this package depends on no billing
contract. Doctrine: [docs/TESTING.md](../../../../../docs/TESTING.md).

## The signature: `session` whole, not `userId` + `role`

`createTestContext` takes `session` as a whole value rather than a `userId` and
`role` it fakes a principal from, because which fields matter is the _feature's_
knowledge: `@acme/billing`'s tests need an `email` for the Stripe customer
lookup; the other features need identity and role only.

It is nested under `session` rather than a bare `user` so that every key a test
passes is a key the real context has. That is what lets a feature's extra
context fields merge straight through instead of needing a translation step.

## Consequences

- Each feature's `tests/backend/utils/test-context.ts` wraps this builder: it
  maps the `FeatureTestContextOptions` its own tests pass (`userId`, `role`)
  onto its principal, and adds the rest of its context. For chat and billing
  that means `entitlements: createMockEntitlements({ tier, credits })`.
- `@acme/trpc` carries a test-only surface. It is the accepted cost of the test
  context being typed against the production one rather than resembling it.
