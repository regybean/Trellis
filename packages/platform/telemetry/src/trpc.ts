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

import type { Context, Span, SpanOptions, Tracer } from '@opentelemetry/api';
import type { ZodType } from 'zod';
import {
  context,
  INVALID_SPAN_CONTEXT,
  SpanKind,
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
  const tracer = getTracer();
  const span = getActiveSpan() ?? trace.wrapSpanContext(INVALID_SPAN_CONTEXT);

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
    const span = tracer.startSpan(
      name,
      {
        ...options?.spanOptions,
        attributes: options?.attributes,
      },
      context.active(),
    );

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => fn(span),
      );
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  };

  return {
    path: '',
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
        const result = schema.parse(data);
        return result;
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
  const tracer = getTracer();
  const set = (attributes: TelemetryAttributes) => {
    procedureSpan.setAttributes(attributes);
  };

  const event = (name: string, attributes?: TelemetryAttributes) => {
    procedureSpan.addEvent(name, attributes);
  };

  /**
   * Create a child span for a timed operation.
   * The span name is automatically prefixed with the procedure path.
   *
   * @example
   * ```ts
   * // Simple usage - just wrap the operation
   * const result = await telemetry.withSpan('fetchUser', async () => {
   *   return db.users.findOne({ id: userId });
   * });
   *
   * // With attributes set on the child span
   * const result = await telemetry.withSpan('processDocument', async (span) => {
   *   span.setAttribute('document.id', docId);
   *   return processDoc(docId);
   * }, { attributes: { 'document.type': 'pdf' } });
   * ```
   */
  const withSpan = async <T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    options?: ChildSpanOptions,
  ): Promise<T> => {
    const fullName = `${procedurePath}.${name}`;
    const span = tracer.startSpan(
      fullName,
      {
        ...options?.spanOptions,
        attributes: options?.attributes,
      },
      context.active(),
    );

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => fn(span),
      );
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  };

  return {
    path: procedurePath,
    traceId: procedureSpan.spanContext().traceId,
    spanId: procedureSpan.spanContext().spanId,
    span: procedureSpan,

    set,
    event,

    /**
     * Create a child span for a timed operation.
     * Prefer this over manually creating spans.
     *
     * @param name - Operation name (will be prefixed with procedure path)
     * @param fn - Function to execute within the span
     * @param options - Optional attributes and span options
     */
    withSpan,

    /**
     * @deprecated Use withSpan instead for cleaner API
     */
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
        const result = schema.parse(data);
        return result;
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
 * Captured context for background/async work.
 * Preserves the trace context so spans created later will be linked to the original trace.
 */
export interface BackgroundTelemetryContext {
  /** The captured OpenTelemetry context */
  capturedContext: Context;
  /** The trace ID for logging/debugging */
  traceId: string;
  /** The parent span ID for logging/debugging */
  parentSpanId: string;
  /** The procedure path for naming child spans */
  procedurePath: string;
}

/**
 * Capture the current telemetry context for use in background/async work.
 *
 * When a tRPC procedure fires off async work (e.g., `void asyncFunction()`),
 * the procedure span ends immediately, orphaning any telemetry from the async work.
 *
 * This function captures the current context so it can be restored in the async work,
 * linking all spans to the original trace.
 *
 * @param telemetry - The procedure telemetry object
 * @returns A context object to pass to the async function
 *
 * @example
 * ```ts
 * // In the tRPC procedure:
 * const bgContext = captureBackgroundContext(ctx.telemetry);
 * void assessmentService.createAssessment({ ...options, bgContext });
 *
 * // In the service:
 * await runInBackground(bgContext, 'createAssessment', async (telemetry) => {
 *   telemetry.set({ 'assessment.id': id });
 *   // ... all telemetry will be linked to the original trace
 * });
 * ```
 */
export function captureBackgroundContext(
  telemetry: ReturnType<typeof createProcedureTelemetry>,
): BackgroundTelemetryContext {
  return {
    capturedContext: context.active(),
    traceId: telemetry.traceId,
    parentSpanId: telemetry.spanId,
    procedurePath: telemetry.path,
  };
}

/**
 * Run an async function within a captured telemetry context.
 *
 * Creates a new span that is a child of the original procedure span,
 * even though the procedure has already returned.
 *
 * @param bgContext - The context captured from `captureBackgroundContext`
 * @param operationName - Name for the background operation span
 * @param fn - The async function to run
 * @returns The result of the async function
 */
export async function runInBackground<T>(
  bgContext: BackgroundTelemetryContext,
  operationName: string,
  fn: (telemetry: ReturnType<typeof createProcedureTelemetry>) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const spanName = bgContext.procedurePath
    ? `${bgContext.procedurePath}.${operationName}`
    : operationName;

  // Create a span within the captured context (links it to the original trace)
  const span = tracer.startSpan(
    spanName,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'background.operation': operationName,
        'background.parentSpanId': bgContext.parentSpanId,
      },
    },
    bgContext.capturedContext,
  );

  // Create a new active context with this span
  const spanContext = trace.setSpan(bgContext.capturedContext, span);

  try {
    // Run the function within the new context
    const result = await context.with(spanContext, async () => {
      // Create a telemetry object scoped to this background span
      const telemetry = createProcedureTelemetry(spanName, span);
      return fn(telemetry);
    });

    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    if (error instanceof Error) {
      span.recordException(error);
    }
    throw error;
  } finally {
    span.end();
  }
}

export { SpanStatusCode } from '@opentelemetry/api';

type Telemetry = ReturnType<typeof createProcedureTelemetry>;

export type { Telemetry };
