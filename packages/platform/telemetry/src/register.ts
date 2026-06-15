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
import { initTelemetry } from './index';

initTelemetry({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'trellis',
  serviceVersion: process.env.npm_package_version ?? '0.0.0',
  otlpEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    'http://localhost:4318/v1/traces',
  debug: process.env.NODE_ENV === 'development',
});
