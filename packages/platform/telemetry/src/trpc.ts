/**
 * tRPC Telemetry Utilities
 *
 * This module provides helpers for integrating OpenTelemetry with tRPC.
 * It creates child spans under the auto-instrumented HTTP parent span.
 *
 * Design: Each procedure gets a single `telemetry` object that is scoped to
 * that procedure. Child spans are automatically prefixed with the procedure path.
 *
 * Best Practices:
 * - Use spans for operations you want to time (external calls, processing phases, etc.)
 * - Use attributes for contextual data about the operation
 * - Events are for significant state changes within a span (rarely needed)
 * - Prefer withSpan() for most operations - it handles errors and timing automatically
 */

import type { Span, SpanOptions, Tracer } from '@opentelemetry/api';
import type { ZodType } from 'zod';
import {
  context,
  INVALID_SPAN_CONTEXT,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

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
 * Core factory: build a telemetry object bound to `span` and `pathPrefix`.
 *
 * @param span - The span all set/event calls target
 * @param pathPrefix - Prefix prepended to child-span names ('' for context telemetry)
 */
function makeTelemetry(span: Span, pathPrefix: string) {
  const tracer = getTracer();

  const set = (attributes: TelemetryAttributes) => {
    span.setAttributes(attributes);
  };

  const event = (name: string, attributes?: TelemetryAttributes) => {
    span.addEvent(name, attributes);
  };

  const withSpan = async <T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    options?: ChildSpanOptions,
  ): Promise<T> => {
    const fullName = pathPrefix ? `${pathPrefix}.${name}` : name;
    const childSpan = tracer.startSpan(
      fullName,
      {
        ...options?.spanOptions,
        attributes: options?.attributes,
      },
      context.active(),
    );

    try {
      const result = await context.with(
        trace.setSpan(context.active(), childSpan),
        () => fn(childSpan),
      );
      return result;
    } catch (error) {
      childSpan.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) {
        childSpan.recordException(error);
      }
      throw error;
    } finally {
      childSpan.end();
    }
  };

  return {
    path: pathPrefix,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    span,

    set,
    event,
    withSpan,

    /** @deprecated Use withSpan instead */
    async withChildSpan<T>(
      name: string,
      fn: (span: Span) => Promise<T> | T,
      options?: SpanOptions,
    ): Promise<T> {
      return withSpan(name, fn, { spanOptions: options });
    },

    parseWithTelemetry<T>(
      schema: ZodType<T>,
      data: unknown,
      schemaName: string,
    ): T {
      try {
        return schema.parse(data);
      } catch (error) {
        set({
          'validation.failed': true,
          'validation.schema': schemaName,
          'validation.error':
            error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    },

    safeParseWithTelemetry<T>(
      schema: ZodType<T>,
      data: unknown,
      schemaName: string,
    ): ReturnType<ZodType<T>['safeParse']> {
      const result = schema.safeParse(data);
      if (!result.success) {
        set({
          'validation.failed': true,
          'validation.schema': schemaName,
          'validation.error': result.error.message,
        });
      }
      return result;
    },
  };
}

/**
 * Create a telemetry context for use in tRPC context.
 *
 * Uses the currently active span when one exists (e.g. an HTTP span from an
 * app that preloads auto-instrumentation, as `apps/nextjs` does). When no SDK
 * established an ambient span — the case for apps that initialize OTel at the
 * server boundary without an HTTP-parent preload (`apps/tanstack-start`) — this
 * falls back to a non-recording span instead of throwing.
 *
 * Either way this object is a throwaway placeholder: the telemetry middleware
 * creates the real procedure-scoped span (`trpc.<path>`) and replaces it. The
 * fallback is a *non-recording* span (never started via the tracer), so it
 * needs no `.end()`, leaks nothing, and silently drops set/event/child-span
 * calls. See docs/adr/0005-telemetry-init-seam.md.
 */
export function createTelemetryContext() {
  const span = getActiveSpan() ?? trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
  return makeTelemetry(span, '');
}

/**
 * Create a procedure-scoped telemetry object.
 * Called by the telemetry middleware when creating the procedure span.
 *
 * @param procedurePath - The tRPC procedure path (e.g., "projects.create")
 * @param procedureSpan - The span created for this procedure
 */
export function createProcedureTelemetry(
  procedurePath: string,
  procedureSpan: Span,
) {
  return makeTelemetry(procedureSpan, procedurePath);
}

export { SpanStatusCode } from '@opentelemetry/api';

type Telemetry = ReturnType<typeof createProcedureTelemetry>;

export type { Telemetry };
