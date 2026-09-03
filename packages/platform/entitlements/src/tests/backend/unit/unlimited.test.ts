import { describe, expect, it } from 'vitest';

import { unlimitedEntitlements } from '../../../unlimited';

/**
 * Pure (unit) tests for the no-billing provider. No Redis, no mocks — the whole
 * point of `unlimitedEntitlements` is that it touches no ledger, so both
 * `consume` and `refund` are observable only as no-ops that leave the resolved
 * balance untouched.
 */
describe('unlimitedEntitlements.refund', () => {
  it('resolves to void without throwing', async () => {
    await expect(
      unlimitedEntitlements.refund('user-1', 'Pro', 5),
    ).resolves.toBeUndefined();
  });

  it('is a no-op: the resolved balance is unchanged after a refund', async () => {
    const before = await unlimitedEntitlements.resolve('user-1');
    await unlimitedEntitlements.refund('user-1', 'Pro', 42);
    const after = await unlimitedEntitlements.resolve('user-1');

    expect(after.credits).toEqual(before.credits);
  });
});
