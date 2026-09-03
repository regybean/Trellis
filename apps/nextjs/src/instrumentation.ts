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
    const { env: telemetryEnv } = await import('@acme/telemetry/env');

    // The OTLP endpoint is authored config, overridable per deploy (@acme/env ADR 0001);
    // the per-app service name stays an app-owned literal (app identity, not
    // shared config).
    initTelemetry({
      serviceName: 'trellis-nextjs',
      serviceVersion: process.env.npm_package_version ?? '0.0.0',
      otlpEndpoint: telemetryEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
      debug: process.env.NODE_ENV === 'development',
    });

    // Resolve active chat+embed providers at boot so a missing/invalid env for a
    // *selected* provider crashes startup, not the first request. Only the chosen
    // providers' envs are validated (resolve.ts switch) — ollama stays AWS-free.
    await import('@acme/models');

    // Create the knowledge-base table at boot (Mastra owns the DDL — @acme/rag ADR 0001).
    // PgVector creates it lazily on first upload, so a freshly-pushed vector DB
    // has no table and reads (documents.list) throw "relation does not exist".
    // Ensuring it here makes reads pure and surfaces an unreachable vector DB at
    // startup, not the first request — same contract as provider resolution.
    const { ensureVectorIndex } = await import('@acme/rag/server');
    await ensureVectorIndex();
  }
}
