/**
 * Side-effecting telemetry preload entry.
 *
 * Importing this module initializes the OpenTelemetry SDK immediately, reading
 * its config from the environment. It exists as the escalation path for full
 * auto-instrumentation parity: preload it before the app's server graph via
 *
 *   NODE_OPTIONS="--import @acme/telemetry/register" <start command>
 *
 * so HTTP/redis/aws auto-instrumentation patches the runtime before any
 * instrumented module loads (giving an HTTP-parent span). Apps that init at the
 * server boundary instead (e.g. a Nitro startup plugin) call `initTelemetry`
 * directly and do not need this. See docs/adr/0005-telemetry-init-seam.md.
 */
import { resolveAppEnv } from '@acme/config';

import { telemetryConfig } from './config';
import { initTelemetry } from './index';

// Context-less server edge (ADR 0026): this preload runs before any app
// composition, so it resolves the `APP_ENV` selector itself and builds the
// telemetry config. `serviceVersion`/`debug` stay `process.env`/`NODE_ENV` reads
// — a build signal and a runtime mode, not config.
const config = telemetryConfig({
  appEnv: resolveAppEnv(process.env.APP_ENV),
  isServer: true,
});

initTelemetry({
  serviceName: config.OTEL_SERVICE_NAME,
  serviceVersion: process.env.npm_package_version ?? '0.0.0',
  otlpEndpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
  debug: process.env.NODE_ENV === 'development',
});
