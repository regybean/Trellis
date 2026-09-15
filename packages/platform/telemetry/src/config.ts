/**
 * The four values a caller used to assemble, read where they already live.
 *
 * `initTelemetry` took five fields and only one of them ever varied: the
 * service name, which is app identity. The other four were the same read at
 * every app's server boundary, so every new app had four chances to get them
 * wrong, and the bag it built had to be valid before the guard in `plan.ts`
 * would accept it.
 *
 * They are read here instead. The endpoint and the off switch come from this
 * slice's own env, which is where they are authored and where a deploy
 * overrides them; the version and the debug flag are process facts rather than
 * config, so they stay `process.env` reads — a build signal and a runtime mode.
 *
 * Deliberately not exported from the package. A caller handed the assembled
 * config could assemble a different one, which is the duplication this removes;
 * a caller that genuinely differs takes `initTelemetryWithConfig` and states
 * all five fields on purpose.
 */
import type { TelemetryConfig } from './plan';
import { env } from './env';

/**
 * The version the process was started with, or `0.0.0`.
 *
 * `npm_package_version` is set by the package runner, so it is a build signal
 * rather than config — absent whenever an app is started some other way, which
 * is most deploys. A blank value counts as absent for the same reason
 * `emptyStringAsUndefined` does in every env factory here: an exported-but-empty
 * variable means unset, and `service.version: ''` would be worse than no
 * version at all.
 */
function serviceVersionFromProcess() {
  const version = process.env.npm_package_version;
  return version === undefined || version === '' ? '0.0.0' : version;
}

/**
 * The configuration for an app that has nothing to say beyond its own name.
 *
 * The endpoint is never absent here: this slice's env resolves it to a URL from
 * the authored profile, or demands one from the environment on a target that
 * unauthored it. So the narrow path cannot reach `planTelemetry`'s
 * enabled-with-no-endpoint throw — the env layer either satisfies it or fails
 * validating itself, naming the variable.
 */
export function telemetryConfigFromEnv(serviceName: string) {
  return {
    serviceName,
    serviceVersion: serviceVersionFromProcess(),
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    enabled: env.OTEL_TELEMETRY_ENABLED,
    debug: process.env.NODE_ENV === 'development',
  } satisfies TelemetryConfig;
}
