/**
 * OpenTelemetry SDK initialization
 *
 * This module sets up the OpenTelemetry SDK with auto-instrumentation
 * and exports traces to a local Jaeger instance via OTLP.
 *
 * IMPORTANT: This file must be imported BEFORE any other imports in your
 * application entry point (e.g., instrumentation.ts in Next.js).
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion?: string;
  /** OTLP endpoint URL. Defaults to http://localhost:4318/v1/traces */
  otlpEndpoint?: string;
  /** Enable console logging of spans for debugging */
  debug?: boolean;
}

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK with HTTP auto-instrumentation.
 *
 * Call this at the very start of your application, before any other imports.
 * In Next.js, use the instrumentation.ts file.
 *
 * @example
 * // apps/nextjs/src/instrumentation.ts
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === 'nodejs') {
 *     const { initTelemetry } = await import('@acme/telemetry');
 *     initTelemetry({ serviceName: 'trellis-nextjs' });
 *   }
 * }
 */
export function initTelemetry(config: TelemetryConfig): void {
  if (sdk) {
    console.warn('[Telemetry] SDK already initialized, skipping...');
    return;
  }

  const otlpEndpoint = config.otlpEndpoint ?? 'http://localhost:4318/v1/traces';

  if (config.debug) {
    console.log(
      `[Telemetry] Initializing SDK for service: ${config.serviceName}`,
    );
    console.log(`[Telemetry] OTLP endpoint: ${otlpEndpoint}`);
  }

  const exporter = new OTLPTraceExporter({
    url: otlpEndpoint,
  });

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion ?? '0.0.0',
  });

  sdk = new NodeSDK({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-net': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-dns': {
          enabled: false,
        },
        '@opentelemetry/instrumentation-winston': {
          enabled: false,
        },
      }),
    ],
  });

  sdk.start();

  if (config.debug) {
    console.log('[Telemetry] SDK started successfully');
  }

  // Graceful shutdown
  const shutdown = () => {
    sdk
      ?.shutdown()
      .then(() => {
        if (config.debug) {
          console.log('[Telemetry] SDK shut down successfully');
        }
      })
      .catch((error) => {
        console.error('[Telemetry] Error shutting down SDK:', error);
      });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Manually shutdown the telemetry SDK.
 * Useful for testing or graceful server shutdown.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
  }
}

// Re-export the OpenTelemetry API for convenience
export { trace, context, SpanStatusCode } from '@opentelemetry/api';
export type { Span, Tracer, SpanOptions } from '@opentelemetry/api';

// Re-export Drizzle instrumentation for use when creating db clients
export { instrumentDrizzleClient } from '@kubiks/otel-drizzle';

// Re-export types for tRPC telemetry integration
export type { ChildSpanOptions } from './trpc';
