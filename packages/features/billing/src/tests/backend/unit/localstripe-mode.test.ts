import { describe, expect, it } from 'vitest';

import { deriveLocalstripeMode } from '../../../lib/localstripe-mode';

// Pure unit: the single server-derived localstripe-mode signal (ADR 0003/0004).
// A boolean projection of the STRIPE_API_BASE env carve-out — both the server
// branches and the config-threaded client read this one value.
describe('deriveLocalstripeMode', () => {
  it('is true when STRIPE_API_BASE points at a localstripe server', () => {
    expect(deriveLocalstripeMode('http://localhost:8420')).toBe(true);
    expect(deriveLocalstripeMode('https://localstripe.internal')).toBe(true);
  });

  it('is false when STRIPE_API_BASE is unset (real Stripe)', () => {
    expect(deriveLocalstripeMode()).toBe(false);
  });

  it('is false for an empty string (unset carve-out)', () => {
    expect(deriveLocalstripeMode('')).toBe(false);
  });
});
