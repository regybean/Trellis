/**
 * OpenTelemetry SDK initialization
 *
 * This module sets up the OpenTelemetry SDK with auto-instrumentation
 * and exports traces to an OTLP collector.
 *
 * Whether it sets up anything at all is `plan.ts`'s decision: telemetry can be
 * switched off, and it refuses to run switched on with no collector to export
 * to. `initTelemetry` acts on that plan and never second-guesses it.
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

import type { TelemetryConfig } from './plan';
import { telemetryConfigFromEnv } from './config';
import { planTelemetry } from './plan';

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK with HTTP auto-instrumentation.
 *
 * Call this at the very start of your application, before any other imports.
 * In Next.js, use the instrumentation.ts file.
 *
 * The service name is the only thing an app has to say. It is app identity —
 * the platform cannot know what your service is called — and the remaining four
 * values are the slice's own to read: the collector endpoint and the off switch
 * from its env, the version and the debug flag from the process. Assembling
 * them at the call site gave every new app four chances to get right what only
 * ever had one answer.
 *
 * @example
 * // an app's src/instrumentation.ts
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === 'nodejs') {
 *     const { initTelemetry } = await import('@acme/telemetry');
 *     initTelemetry('acme-web');
 *   }
 * }
 */
export function initTelemetry(serviceName: string) {
  initTelemetryWithConfig(telemetryConfigFromEnv(serviceName));
}

/**
 * Initialize the SDK from a configuration stated in full.
 *
 * For the caller that genuinely differs — a one-off script exporting under
 * another service version, a process pointed at a second collector — so
 * narrowing the common entry costs nobody the ability to override. It states
 * all five fields on purpose, and the guard below still holds it to a valid
 * one: enabled with no endpoint raises here, not at the call site.
 */
export function initTelemetryWithConfig(config: TelemetryConfig) {
  if (sdk) {
    console.warn('[Telemetry] SDK already initialized, skipping...');
    return;
  }

  // Switched off, or switched on with nowhere to send traces — both are
  // settled here, before an exporter or a span processor exists.
  const plan = planTelemetry(config);

  if (!plan) {
    if (config.debug) {
      console.log('[Telemetry] disabled — no exporter, no span processor');
    }
    return;
  }

  if (plan.debug) {
    console.log(
      `[Telemetry] Initializing SDK for service: ${plan.serviceName}`,
    );
    console.log(`[Telemetry] OTLP endpoint: ${plan.otlpEndpoint}`);
  }

  const exporter = new OTLPTraceExporter({
    url: plan.otlpEndpoint,
  });

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: plan.serviceName,
    [ATTR_SERVICE_VERSION]: plan.serviceVersion,
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

  if (plan.debug) {
    console.log('[Telemetry] SDK started successfully');
  }

  // Graceful shutdown
  const shutdown = () => {
    sdk
      ?.shutdown()
      .then(() => {
        if (plan.debug) {
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

// The config a caller hands `initTelemetryWithConfig`. The guard that reads it
// (`planTelemetry`) stays internal — a caller cannot be given the option of
// running it instead of the initialiser, which is the point of it.
export type { TelemetryConfig } from './plan';
