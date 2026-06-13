/**
 * Next.js Instrumentation
 *
 * This file is automatically loaded by Next.js to set up instrumentation
 * before any other code runs. We use it to initialize OpenTelemetry.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only initialize telemetry on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initTelemetry } = await import('@acme/telemetry');

    initTelemetry({
      serviceName: 'trellis',
      serviceVersion: process.env.npm_package_version ?? '0.0.0',
      // Use environment variable for flexibility
      otlpEndpoint:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        'http://localhost:4318/v1/traces',
      debug: process.env.NODE_ENV === 'development',
    });
  }
}
