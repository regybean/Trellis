import { describe, expect, it } from 'vitest';

import { billingConfig } from '../../../config';

// Pure unit: billing's server config-as-code (ADR 0026 follow-up), now the
// server side of the merged `billingConfig`. Covers the localstripe-vs-real
// signal (a discriminated union resolved per deploy target) and the invariant
// that the localstripe `apiBase` must never leak into a real (staging/production)
// build.
describe('billingConfig (server)', () => {
  it('development uses localstripe with the local apiBase + checkout paths', () => {
    const config = billingConfig({
      appEnv: 'development',
      isServer: true,
    });

    expect(config.stripe).toEqual({
      mode: 'localstripe',
      apiBase: 'http://localhost:8420',
    });
    expect(config.checkoutSuccessPath).toBe('/billing?success=true');
    expect(config.checkoutCancelPath).toBe('/billing?canceled=true');
  });

  it('staging/production select real Stripe and strip the inherited apiBase', () => {
    for (const appEnv of ['staging', 'production'] as const) {
      const { stripe } = billingConfig({ appEnv, isServer: true });
      // The `real` variant carries no URL — the overlay-merged localstripe
      // `apiBase` is stripped at parse time (zod object-strip).
      expect(stripe).toEqual({ mode: 'real' });
      expect('apiBase' in stripe).toBe(false);
    }
  });

  it('keeps the env-invariant checkout paths across every deploy target', () => {
    for (const appEnv of ['development', 'staging', 'production'] as const) {
      const config = billingConfig({ appEnv, isServer: true });
      expect(config.checkoutSuccessPath).toBe('/billing?success=true');
      expect(config.checkoutCancelPath).toBe('/billing?canceled=true');
    }
  });
});
