/**
 * What `initTelemetry` decides before it constructs anything.
 *
 * The decision is separated from the doing for one reason: the two things that
 * can be wrong about a telemetry configuration — it is switched off, or it is
 * switched on with nowhere to export to — both have to be settled *before* an
 * OTLP exporter and a `BatchSpanProcessor` exist. A batch processor aimed at an
 * address nothing is listening on retries in the background for the life of the
 * process, quietly and permanently, so "construct it and find out" is not an
 * option.
 *
 * Keeping it here rather than at the call sites is the load-bearing part. There
 * are several callers — each app's server boundary plus the `register.ts`
 * preload — and a check repeated at each of them is a check the next one
 * forgets. `initTelemetry` calls this first and can act only on what it
 * returns, so the guard is unforgettable by construction.
 */

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion?: string;
  /**
   * OTLP endpoint URL. Required when telemetry is on — there is deliberately no
   * default, because the only sensible one is a local collector address and
   * that is wrong on every target except a developer's machine.
   */
  otlpEndpoint?: string;
  /**
   * The off switch. Absent means on, so a caller that passes no opinion keeps
   * the behaviour it had before the switch existed.
   */
  enabled?: boolean;
  /** Enable console logging of spans for debugging */
  debug?: boolean;
}

/**
 * Resolve a configuration into the values the SDK needs, or `null` when
 * telemetry is off and there is nothing to build.
 *
 * Throws when telemetry is on with no endpoint: a half-configured target is
 * better as a crash at boot than as a process that spends its life retrying an
 * export nobody receives. An empty string counts as absent for the same reason
 * `emptyStringAsUndefined` does in every env factory here — an exported-but-blank
 * variable means "unset", and blanking the endpoint is how a deploy target turns
 * the exporter off from the outside.
 */
export function planTelemetry(config: TelemetryConfig) {
  if (config.enabled === false) return null;

  if (config.otlpEndpoint === undefined || config.otlpEndpoint === '') {
    throw new Error(
      '[Telemetry] enabled with no OTLP endpoint. Set OTEL_EXPORTER_OTLP_ENDPOINT to your collector, or set OTEL_TELEMETRY_ENABLED=false to run without telemetry.',
    );
  }

  return {
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion ?? '0.0.0',
    otlpEndpoint: config.otlpEndpoint,
    debug: config.debug ?? false,
  };
}
