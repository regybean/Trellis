import { afterEach, describe, expect, it, vi } from 'vitest';

// Pure unit: billing's server-side authored config (@acme/env ADR 0001). Covers the
// localstripe-vs-real signal (a discriminated union resolved per deploy target)
// and the invariant that the localstripe `apiBase` must never leak into a real
// (staging/production) build.
//
// `env.ts` resolves `APP_ENV` at module load, so a deploy target is exercised by
// stubbing the selector and re-importing the module — the same thing a container
// does at boot. `resetModules` is what makes the re-import re-resolve rather than
// hand back the cached first evaluation.
async function billingEnvFor(appEnv: string) {
  vi.stubEnv('APP_ENV', appEnv);
  if (appEnv !== 'development') {
    // The staging/production overlays **unauthor** the two Stripe secrets, so a
    // real target has to supply them — which is the behaviour under test as much
    // as the connection is. Development authors localstripe's placeholders, so it
    // needs nothing.
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_stub');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_stub');
  }
  vi.resetModules();
  const { env } = await import('../../../env');
  return env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('billing env (server)', () => {
  it('development uses localstripe with the local apiBase + checkout paths', async () => {
    const env = await billingEnvFor('development');

    expect(env.STRIPE_CONNECTION).toEqual({
      mode: 'localstripe',
      apiBase: 'http://localhost:8420',
    });
    expect(env.STRIPE_CHECKOUT_SUCCESS_PATH).toBe('/billing?success=true');
    expect(env.STRIPE_CHECKOUT_CANCEL_PATH).toBe('/billing?canceled=true');
  });

  it('staging/production select real Stripe and strip the inherited apiBase', async () => {
    for (const appEnv of ['staging', 'production']) {
      const { STRIPE_CONNECTION } = await billingEnvFor(appEnv);
      // The `real` variant carries no URL — the overlay-merged localstripe
      // `apiBase` is stripped at parse time (zod object-strip).
      expect(STRIPE_CONNECTION).toEqual({ mode: 'real' });
      expect('apiBase' in STRIPE_CONNECTION).toBe(false);
    }
  });

  it('keeps the env-invariant checkout paths across every deploy target', async () => {
    for (const appEnv of ['development', 'staging', 'production']) {
      const env = await billingEnvFor(appEnv);
      expect(env.STRIPE_CHECKOUT_SUCCESS_PATH).toBe('/billing?success=true');
      expect(env.STRIPE_CHECKOUT_CANCEL_PATH).toBe('/billing?canceled=true');
    }
  });

  it('lets a same-named variable retune the connection whole (@acme/env ADR 0001 §4)', async () => {
    // The override arrives as one JSON document, so a half-configured connection
    // stays unrepresentable — `jsonEnv` validates it against the same union the
    // profile literal goes through.
    vi.stubEnv('STRIPE_CONNECTION', '{"mode":"real"}');

    const env = await billingEnvFor('development');

    expect(env.STRIPE_CONNECTION).toEqual({ mode: 'real' });
  });

  it('rejects an override the union does not accept', async () => {
    vi.stubEnv('STRIPE_CONNECTION', '{"mode":"localstripe"}');

    await expect(billingEnvFor('development')).rejects.toThrow(
      /STRIPE_CONNECTION/,
    );
  });
});
