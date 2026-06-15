import { definePlugin } from 'nitro';

import { initTelemetry } from '@acme/telemetry';

/**
 * Telemetry bootstrap — the app-owned half of the telemetry seam.
 *
 * The platform (`@acme/trpc`) no longer assumes a framework left an ambient
 * span, so each app initializes the OTel SDK at its own server boundary. This is
 * the TanStack Start analogue of `apps/nextjs`'s `instrumentation.ts`.
 *
 * The work runs at *module load*, not inside the plugin body: Nitro invokes
 * plugin functions synchronously and does not await them, so an async plugin
 * body could not block startup. Registering this file as a Nitro plugin is just
 * the hook that gets it imported during server bootstrap; the server's module
 * graph evaluation awaits this module's top-level await, preserving the same
 * fail-fast contract as Next's awaited `register()`.
 *
 * Because this loads after the server graph, HTTP auto-instrumentation does not
 * retroactively patch it: traces are rooted at the tRPC procedure span
 * (`trpc.<path>`), not an HTTP parent. DB spans are unaffected (manual
 * `instrumentDrizzleClient`). For full HTTP-parent parity, preload
 * `@acme/telemetry/register` via NODE_OPTIONS instead. See
 * docs/adr/0005-telemetry-init-seam.md.
 */
initTelemetry({
  serviceName: 'trellis-tanstack-start',
  serviceVersion: process.env.npm_package_version ?? '0.0.0',
  otlpEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    'http://localhost:4318/v1/traces',
  debug: process.env.NODE_ENV === 'development',
});

// Boot-time parity with apps/nextjs's instrumentation.ts: resolve the active
// chat+embed providers so a missing/invalid env for a *selected* provider
// crashes startup, not the first request.
await import('@acme/models');

// Create the knowledge-base table at boot (Mastra owns the DDL — ADR-0002), so a
// freshly-pushed vector DB has the table before the first documents.list read.
const { ensureVectorIndex } = await import('@acme/rag/server');
await ensureVectorIndex();

export default definePlugin(() => {
  // Bootstrap runs on import (above); nothing per-app-instance to do here.
});
