import { describe, expect, it } from 'vitest';

import { initTelemetryWithConfig } from '../../../index';
import { planTelemetry } from '../../../plan';

/**
 * The guard, at both levels it has to hold.
 *
 * `planTelemetry` is asserted directly because it is the only path to an
 * exporter: the initialiser constructs nothing until it has a plan, so "no plan"
 * *is* "no exporter and no span processor". That is the assertion, rather than a
 * spy on the exporter constructor — a unit test that needs a collaborator to
 * stand in for the thing under test is describing the implementation, and
 * mocking the OTel SDK would pin the shape of the code rather than the behaviour
 * a caller depends on.
 *
 * `initTelemetryWithConfig` is then asserted for the raising case, because the
 * load-bearing claim is about *where* the check lives. A test that only
 * exercised the helper would pass just as happily if a call site were the one
 * doing the checking. The full-config form is where that matters now: it is the
 * only entry a caller can hand an invalid configuration to, since the narrow
 * `initTelemetry(serviceName)` reads an endpoint this slice's env has already
 * validated. Its own coverage is in `init.test.ts`.
 *
 * No test here starts the SDK. The suite runs with `isolate: false` and one
 * worker, so a started SDK would patch the runtime for everything after it — and
 * a started SDK pointed at a collector that does not exist is the exact defect
 * under repair. So the "enabled with an endpoint" case is asserted as the plan
 * the SDK would be built from, and the initialiser's success path is left to the
 * apps that run it. Said out loud rather than left as a gap.
 */

const ENDPOINT = 'http://localhost:4318/v1/traces';

describe('planTelemetry — switched off', () => {
  it('plans nothing, so there is nothing to construct', () => {
    expect(planTelemetry({ serviceName: 'acme', enabled: false })).toBeNull();
  });

  it('plans nothing even when an endpoint is configured', () => {
    // Off beats configured: an operator who set the switch to false has said
    // what they want, and a collector address left over in the environment does
    // not overrule it.
    expect(
      planTelemetry({
        serviceName: 'acme',
        enabled: false,
        otlpEndpoint: ENDPOINT,
      }),
    ).toBeNull();
  });
});

describe('planTelemetry — switched on', () => {
  it('raises when there is no endpoint to export to', () => {
    expect(() => planTelemetry({ serviceName: 'acme', enabled: true })).toThrow(
      /no OTLP endpoint/,
    );
  });

  it('raises when the endpoint is set but blank', () => {
    // An exported-but-empty variable is "unset" everywhere else in this repo
    // (`emptyStringAsUndefined`), and blanking the endpoint is how a deploy
    // target with no collector expresses itself. It must not resolve to a URL
    // of `''`.
    expect(() =>
      planTelemetry({ serviceName: 'acme', enabled: true, otlpEndpoint: '' }),
    ).toThrow(/no OTLP endpoint/);
  });

  it('plans the SDK from the endpoint it was given', () => {
    expect(
      planTelemetry({
        serviceName: 'acme',
        serviceVersion: '1.2.3',
        otlpEndpoint: ENDPOINT,
        enabled: true,
        debug: true,
      }),
    ).toEqual({
      serviceName: 'acme',
      serviceVersion: '1.2.3',
      otlpEndpoint: ENDPOINT,
      debug: true,
    });
  });
});

describe('planTelemetry — an absent switch', () => {
  it('is on, so a caller with no opinion behaves as it did before', () => {
    expect(
      planTelemetry({ serviceName: 'acme', otlpEndpoint: ENDPOINT }),
    ).toEqual({
      serviceName: 'acme',
      serviceVersion: '0.0.0',
      otlpEndpoint: ENDPOINT,
      debug: false,
    });
  });

  it('still raises with no endpoint — absent is on, not lenient', () => {
    expect(() => planTelemetry({ serviceName: 'acme' })).toThrow(
      /no OTLP endpoint/,
    );
  });
});

describe('initTelemetryWithConfig — the guard is inside the initialiser', () => {
  it('raises on an enabled configuration with no endpoint', () => {
    // The whole point: a caller stating all five fields can state an invalid
    // five, and the next one to do so would forget to check. The initialiser
    // refuses rather than trusting it.
    expect(() => initTelemetryWithConfig({ serviceName: 'acme' })).toThrow(
      /no OTLP endpoint/,
    );
  });

  it('returns quietly when telemetry is switched off', () => {
    expect(() =>
      initTelemetryWithConfig({
        serviceName: 'acme',
        enabled: false,
        otlpEndpoint: ENDPOINT,
      }),
    ).not.toThrow();
  });

  it('latches nothing when it was switched off', () => {
    initTelemetryWithConfig({ serviceName: 'acme', enabled: false });

    // If the disabled call had built an SDK, this one would hit the
    // already-initialized early return and pass silently. It reaches the guard,
    // so the disabled call left the module untouched.
    expect(() => initTelemetryWithConfig({ serviceName: 'acme' })).toThrow(
      /no OTLP endpoint/,
    );
  });
});
