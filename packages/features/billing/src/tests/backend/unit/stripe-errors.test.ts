/**
 * Typed billing-error seam tests.
 *
 * Replaces the untested cross-file string coupling: the checkout UI used to
 * substring-match prose error messages. Now it branches on a stable code, and
 * this round-trips billingError -> toBillingErrorCode to lock the contract.
 */
import { describe, expect, it } from 'vitest';

import {
  billingError,
  BillingErrorCode,
  toBillingErrorCode,
} from '../../../utils/stripe-errors';

describe('billingError / toBillingErrorCode', () => {
  it('round-trips every code through a TRPCError', () => {
    for (const code of Object.values(BillingErrorCode)) {
      const error = billingError(code, 'BAD_REQUEST', 'human readable');
      expect(error.message).toBe(code);
      expect(toBillingErrorCode(error)).toBe(code);
      // Human text is preserved on the cause, not the machine message.
      const { cause } = error;
      expect(cause).toBeInstanceOf(Error);
      if (cause instanceof Error) {
        expect(cause.message).toBe('human readable');
      }
    }
  });

  it('recovers a code from a plain serialized error shape (client side)', () => {
    // TRPCClientError only carries `message` — simulate that shape.
    const serialized = { message: BillingErrorCode.NoDefaultPrice };
    expect(toBillingErrorCode(serialized)).toBe(
      BillingErrorCode.NoDefaultPrice,
    );
  });

  it('returns null for unknown / non-billing errors', () => {
    expect(toBillingErrorCode(new Error('some other failure'))).toBeNull();
    expect(
      toBillingErrorCode({ message: 'BILLING_NOT_A_REAL_CODE' }),
    ).toBeNull();
    expect(toBillingErrorCode(null)).toBeNull();
    expect(toBillingErrorCode('string')).toBeNull();
    expect(toBillingErrorCode({ noMessage: true })).toBeNull();
  });
});
