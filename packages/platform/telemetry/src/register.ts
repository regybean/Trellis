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
import { env } from './env';
import { initTelemetry } from './index';

// This preload runs before any app composition, so it reads the slice's own env
// (ADR 0033): the values are authored as profile defaults and any of them can be
// retuned by a same-named variable, which is how a deploy points at its own
// collector. `serviceVersion`/`debug` stay `process.env`/`NODE_ENV` reads — a
// build signal and a runtime mode, not config.

initTelemetry({
  serviceName: env.OTEL_SERVICE_NAME,
  serviceVersion: process.env.npm_package_version ?? '0.0.0',
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  debug: process.env.NODE_ENV === 'development',
});
