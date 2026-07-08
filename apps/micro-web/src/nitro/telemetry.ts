import { definePlugin } from 'nitro';

import { initTelemetry } from '@acme/telemetry';

/**
 * Telemetry bootstrap — the app-owned half of the telemetry seam, the TanStack
 * Start analogue of apps/nextjs's instrumentation.ts (ADR 0005).
 *
 * micro-web is a client-only frontend: the feature ROUTERS run in separate
 * service processes reached through the gateway (ADR 0023), so — unlike the slim
 * app this was cloned from — this bootstrap does NOT resolve model providers or
 * create the vector index. The one-shot migrator (`@acme/micro-migrate`) owns
 * that DDL, and each service resolves its own providers. Only telemetry init
 * remains here.
 */
initTelemetry({
  serviceName: 'trellis-micro-web',
  serviceVersion: process.env.npm_package_version ?? '0.0.0',
  otlpEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    'http://localhost:4318/v1/traces',
  debug: process.env.NODE_ENV === 'development',
});

export default definePlugin(() => {
  // Bootstrap runs on import (above); nothing per-app-instance to do here.
});
