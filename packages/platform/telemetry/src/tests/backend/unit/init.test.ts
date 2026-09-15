import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The narrow entry: an app passes the one field that is its own.
 *
 * Four of the five values `initTelemetry` used to be handed were the same read
 * at every call site — the version off `npm_package_version`, the endpoint and
 * the off switch from this slice's env, debug off `NODE_ENV`. They are read
 * inside the slice now, so the composition is asserted here, once, instead of
 * being trusted at four app boundaries no test reaches.
 *
 * `telemetryConfigFromEnv` is asserted through a relative import because it is
 * internal on purpose: a caller handed the assembled bag could assemble a
 * different one, which is the thing being removed. It is also the level where
 * the four values are visible without starting an SDK.
 *
 * No test here starts one, for the reason `plan.test.ts` gives: the suite runs
 * one non-isolated worker, so a started SDK patches the runtime for everything
 * after it. That rules out the enabled path through the narrow entry, so the
 * switch is stubbed off before it is called. The enabled-with-no-endpoint throw
 * is unreachable from the narrow entry by construction — this slice's env
 * resolves the endpoint to a URL or fails validating itself — so it is asserted
 * on the full-config form, in `plan.test.ts`.
 */

/** Any app's literal. This one is a stand-in, not one of this repo's. */
const APP = 'acme-web';

/** The authored development endpoint — `src/env.ts`'s `default` profile. */
const AUTHORED_ENDPOINT = 'http://localhost:4318/v1/traces';

/**
 * `env.ts` resolves its profile at module load, so an override is exercised by
 * stubbing the variable and re-importing — what a container does at boot.
 */
async function configFor(serviceName: string) {
  vi.resetModules();
  const { telemetryConfigFromEnv } = await import('../../../config');
  return telemetryConfigFromEnv(serviceName);
}

async function freshTelemetry() {
  vi.resetModules();
  return import('../../../index');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the config an app no longer assembles', () => {
  it('carries the service name it was given, unchanged', async () => {
    const config = await configFor(APP);

    expect(config.serviceName).toBe(APP);
  });

  it('reads the collector endpoint and the switch from the slice env', async () => {
    expect(await configFor(APP)).toMatchObject({
      otlpEndpoint: AUTHORED_ENDPOINT,
      enabled: true,
    });
  });

  it('follows the switch when the environment turns telemetry off', async () => {
    vi.stubEnv('OTEL_TELEMETRY_ENABLED', 'false');
    const config = await configFor(APP);

    expect(config.enabled).toBe(false);
  });

  it('takes the service version from the process the app was started in', async () => {
    vi.stubEnv('npm_package_version', '4.5.6');
    const config = await configFor(APP);

    expect(config.serviceVersion).toBe('4.5.6');
  });

  it('falls back to 0.0.0 when the runner set no package version', async () => {
    // Blank is the stubbable spelling of absent, and absent is the common case:
    // no package here carries a `version`, so most boots have nothing to read.
    vi.stubEnv('npm_package_version', '');
    const config = await configFor(APP);

    expect(config.serviceVersion).toBe('0.0.0');
  });

  it('leaves debug off anywhere but development', async () => {
    // `NODE_ENV` is `test` here, which is the point: debug tracks the runtime
    // mode rather than being a fifth thing a caller decides.
    const config = await configFor(APP);

    expect(config.debug).toBe(false);
  });
});

describe('initTelemetry — a service name and nothing else', () => {
  it('needs no endpoint, switch or version from its caller', async () => {
    vi.stubEnv('OTEL_TELEMETRY_ENABLED', 'false');
    const { initTelemetry } = await freshTelemetry();

    expect(() => initTelemetry(APP)).not.toThrow();
  });

  it('constructs nothing when the environment turns telemetry off', async () => {
    vi.stubEnv('OTEL_TELEMETRY_ENABLED', 'false');
    const { initTelemetry, initTelemetryWithConfig } = await freshTelemetry();

    initTelemetry(APP);

    // A latched SDK would send this to the already-initialized early return and
    // pass silently. It reaches the guard instead, so the disabled call left
    // the module untouched.
    expect(() => initTelemetryWithConfig({ serviceName: APP })).toThrow(
      /no OTLP endpoint/,
    );
  });
});
