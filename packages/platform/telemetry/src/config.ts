import { z } from 'zod/v4';

import type { ConfigContext } from '@acme/config';
import { createConfig } from '@acme/config';

/**
 * Telemetry config-as-code (ADR 0026) — this slice's first config. The OTLP
 * collector endpoint is the shared, per-deploy-target value: `localhost` in
 * development, a real collector in staging/production (add those overlays when
 * the endpoints exist). `OTEL_SERVICE_NAME` is the generic preload's default
 * (`register.ts`); apps that init at their own server boundary pass their own
 * per-app service name literal instead. Server-side — telemetry runs pre-app.
 */
export function telemetryConfig(context: ConfigContext) {
  return createConfig({
    server: {
      OTEL_SERVICE_NAME: z.string().nonempty(),
      OTEL_EXPORTER_OTLP_ENDPOINT: z.url(),
    },
    profiles: {
      default: {
        server: {
          OTEL_SERVICE_NAME: 'trellis',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318/v1/traces',
        },
      },
    },
    context,
  });
}
