import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod/v4';

import { jsonEnv, readEnv, resolveAppEnv, withProfiles } from '@acme/env';

/** The deploy-target selector, resolved at this slice's `process.env` edge. */
const appEnv = resolveAppEnv(process.env.APP_ENV);

/**
 * Telemetry's environment, declared once. All three keys are **config** — they
 * carry profile values, so a clean checkout exports to the local collector with
 * no `.env` rows — and all three are env-overridable, which is what a real
 * deploy needs: the collector endpoint is the value that differs per target, and
 * pointing an app at one should not require re-authoring a profile.
 *
 * `OTEL_SERVICE_NAME` is the generic preload's default (`register.ts`); apps that
 * init at their own server boundary pass their own per-app service name literal
 * to `initTelemetry` instead. Server-side — telemetry runs pre-app.
 *
 * `OTEL_TELEMETRY_ENABLED` is the off switch, and it goes through `jsonEnv`
 * rather than `z.coerce.boolean()` for the reason every boolean here does:
 * coercion is JavaScript truthiness, so `'false'` would become `true` and an
 * operator turning telemetry off would have turned it on. Authored on, so the
 * local collector keeps working with no configuration; an operator with no
 * collector sets it to `false` and no exporter is ever constructed.
 *
 * It is not OTel's own `OTEL_SDK_DISABLED`. That flag is read by the SDK inside
 * `start()`, which is *after* the OTLP exporter and the `BatchSpanProcessor`
 * have been constructed — and a batch processor pointed at an address nothing is
 * listening on is precisely the thing this key exists to avoid. The polarity is
 * positive for the same reason: the value a profile authors should read as the
 * state it produces.
 */
export const env = createEnv({
  clientPrefix: 'NEXT_PUBLIC_',
  client: {},
  server: {
    OTEL_SERVICE_NAME: z.string().nonempty(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
    OTEL_TELEMETRY_ENABLED: jsonEnv(z.boolean()),
  },
  createFinalSchema: (shape) =>
    withProfiles(shape, appEnv, {
      default: {
        OTEL_SERVICE_NAME: 'acme',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
        OTEL_TELEMETRY_ENABLED: true,
      },
    }),
  runtimeEnv: {
    OTEL_SERVICE_NAME: readEnv('OTEL_SERVICE_NAME'),
    OTEL_EXPORTER_OTLP_ENDPOINT: readEnv('OTEL_EXPORTER_OTLP_ENDPOINT'),
    OTEL_TELEMETRY_ENABLED: readEnv('OTEL_TELEMETRY_ENABLED'),
  },
  emptyStringAsUndefined: true,
});
