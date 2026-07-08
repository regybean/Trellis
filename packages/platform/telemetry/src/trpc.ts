/**
 * Ambient tRPC telemetry helpers.
 *
 * There is no telemetry object threaded through the tRPC context (see
 * docs/adr/0023-ambient-telemetry-no-context-object.md). The telemetry
 * middleware in `@acme/trpc` creates and *activates* the per-procedure span;
 * everything else reads that span ambiently from the active OTel context.
 *
 * - `setSpanAttributes(attrs)` tags the currently active span (noop if none).
 * - `withSpan(name, fn, opts?)` runs `fn` inside a child of the active span,
 *   recording errors/timing and activating the child so nested calls target it.
 */

import type { Span, SpanOptions, Tracer } from '@opentelemetry/api';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';

const TRACER_NAME = 'trpc';

/** Attribute record type for telemetry */
type TelemetryAttributes = Record<string, string | number | boolean>;

/** Options for creating a child span */
export interface ChildSpanOptions {
  /** Attributes to set on the span when it starts */
  attributes?: TelemetryAttributes;
  /** OpenTelemetry span options */
  spanOptions?: SpanOptions;
}

/**
 * Get the shared tracer instance for tRPC operations.
 */
export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Get the currently active span from context.
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Set attributes on the currently active span. A noop when no span is active
 * (e.g. before the telemetry middleware runs, or with no SDK initialized), so
 * callers never guard on the presence of telemetry.
 */
export function setSpanAttributes(attributes: TelemetryAttributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

/**
 * Run `fn` inside a child of the currently active span. The child is activated
 * in OTel context so nested `withSpan`/`setSpanAttributes` calls target it;
 * errors are recorded and the span is always ended. When no span is active the
 * child roots a fresh trace.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  options?: ChildSpanOptions,
): Promise<T> {
  const childSpan = getTracer().startSpan(
    name,
    {
      ...options?.spanOptions,
      attributes: options?.attributes,
    },
    context.active(),
  );

  try {
    return await context.with(trace.setSpan(context.active(), childSpan), () =>
      fn(childSpan),
    );
  } catch (error) {
    childSpan.setStatus({ code: SpanStatusCode.ERROR });
    if (error instanceof Error) {
      childSpan.recordException(error);
    }
    throw error;
  } finally {
    childSpan.end();
  }
}

export { SpanStatusCode } from '@opentelemetry/api';
