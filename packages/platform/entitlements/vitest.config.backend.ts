import { backendProject } from '@acme/test-utils/vitest';

// A pure contract package — no Redis, no Stripe, no env, no IO — so the suite
// declares no infra (no globalSetup): the `unlimitedEntitlements` provider is
// exercised purely in memory. The Redis-backed adapter that implements the same
// contract is covered against a real Redis in `@acme/subscriptions`.
export default backendProject({
  webapp: 'entitlements_test',
});
