import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { readEnv, resolveAppEnv, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Telemetry's environment, declared once (@acme/env ADR 0001). Both keys are **config** —
 * they carry profile values, so a clean checkout exports to the local collector
 * with no `.env` rows — and both are env-overridable (@acme/env ADR 0001 §4), which is what
 * a real deploy needs: the collector endpoint is the value that differs per
 * target, and pointing an app at one should not require re-authoring a profile.
 *
 * `OTEL_SERVICE_NAME` is the generic preload's default (`register.ts`); apps that
 * init at their own server boundary pass their own per-app service name literal
 * to `initTelemetry` instead. Server-side — telemetry runs pre-app.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  server: {
    OTEL_SERVICE_NAME: z.string().nonempty(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: {
        OTEL_SERVICE_NAME: 'trellis',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
      },
    }),
  runtimeEnv: {
    OTEL_SERVICE_NAME: readEnv('OTEL_SERVICE_NAME'),
    OTEL_EXPORTER_OTLP_ENDPOINT: readEnv('OTEL_EXPORTER_OTLP_ENDPOINT'),
  },
  emptyStringAsUndefined: true,
});
