# Mounting `@acme/telemetry`

An app mounts this by calling `initTelemetry` at its **own server boundary**,
before the rest of the server graph loads. The platform assumes no framework left
an ambient span, so this init is app-owned and looks different on each framework
(ADR 0005).

## Mounted by

- `apps/nextjs` — `src/instrumentation.ts`
- `apps/nextjs-slim` — `src/instrumentation.ts`
- `apps/tanstack-start` — `src/nitro/telemetry.ts`, registered in `vite.config.ts`
- `apps/tanstack-slim` — `src/nitro/telemetry.ts`, registered in `vite.config.ts`

## Glue

### Next.js — `apps/nextjs/src/instrumentation.ts`

```ts
export async function register() {
  // Only initialize telemetry on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initTelemetry } = await import('@acme/telemetry');
    const { env: telemetryEnv } = await import('@acme/telemetry/env');

    // The OTLP endpoint is authored config, overridable per deploy (ADR 0033);
    // the per-app service name stays an app-owned literal (app identity, not
    // shared config).
    initTelemetry({
      serviceName: 'trellis-nextjs',
      serviceVersion: process.env.npm_package_version ?? '0.0.0',
      otlpEndpoint: telemetryEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
      debug: process.env.NODE_ENV === 'development',
    });
  }
}
```

Next.js loads `instrumentation.ts` before any other code. The `NEXT_RUNTIME`
guard matters — the Node SDK must not run on Edge.

### TanStack Start — `apps/tanstack-start/src/nitro/telemetry.ts`

```ts
import { definePlugin } from 'nitro';

import { initTelemetry } from '@acme/telemetry';
import { env as telemetryEnv } from '@acme/telemetry/env';

initTelemetry({
  serviceName: 'trellis-tanstack-start',
  serviceVersion: process.env.npm_package_version ?? '0.0.0',
  otlpEndpoint: telemetryEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
  debug: process.env.NODE_ENV === 'development',
});

export default definePlugin(() => {
  // Bootstrap runs on import (above); nothing per-app-instance to do here.
});
```

The work runs at **module load**, not inside the plugin body: Nitro invokes
plugin functions synchronously and does not await them, so an async body could
not block startup. Registering the file as a plugin is only the hook that gets it
imported.

Registered explicitly rather than by directory scan — `apps/tanstack-start/vite.config.ts`:

```ts
nitro({
  plugins: [fileURLToPath(new URL('./src/nitro/telemetry.ts', import.meta.url))],
}),
```

### The trade-off on the Nitro path

Because the plugin loads _after_ the server graph, HTTP auto-instrumentation does
not retroactively patch it: traces are rooted at the tRPC procedure span
(`trpc.<path>`) rather than an HTTP parent. DB spans are unaffected (manual
`instrumentDrizzleClient`). For HTTP-parent parity, preload instead:

```bash
NODE_OPTIONS="--import @acme/telemetry/register" <start command>
```

That is what the `./register` export is for — a generic preload that reads
`OTEL_SERVICE_NAME` from env instead of taking a literal.

### Service name is app-owned

`serviceName` is a literal in the app, not a config row. It is app identity; the
collector endpoint is the value that differs per deploy target, and that one is
config.

## Env

Factory: `src/env.ts`, exported as `@acme/telemetry/env`.

| Key                           | Kind   | Notes                                                                                                              |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `OTEL_SERVICE_NAME`           | config | authored `trellis`; only the `./register` preload reads it — apps that call `initTelemetry` pass their own literal |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | config | authored `http://localhost:4318/v1/traces`; the key a real deploy overrides                                        |

No secrets. Server-side only — telemetry runs pre-app.

## Infra

`acme.infra: ["jaeger"]` → the `jaeger` profile in `deploy/compose.yaml`
(`jaegertracing/jaeger:latest`). Ports: `16686` (UI), `4318` (OTLP HTTP — what
the authored endpoint points at), `4317` (OTLP gRPC).

A consumer pointing at its own collector overrides
`OTEL_EXPORTER_OTLP_ENDPOINT` and does not need this container at all.

## Also mount

`@acme/env`. `@acme/trpc` depends on this package for its procedure spans, so an
app mounting tRPC gets the instrumentation whether or not it calls
`initTelemetry` — without the init, the spans are created and dropped.
