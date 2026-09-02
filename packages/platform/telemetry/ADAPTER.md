# Mounting `@acme/telemetry`

Tracing. Your app initialises it once at process start; every mounted package
then produces spans without being handed anything
([ADR 0005](../../../docs/adr/0005-telemetry-init-seam.md)).

## What it gives you

- `initTelemetry` — one call that configures the exporter and instrumentation
  for the whole process.
- Automatic per-procedure spans on every tRPC procedure, so mounting a feature
  gets you its traces with no per-feature wiring.
- Database query instrumentation, so a slow procedure shows which query it
  spent its time in.
- The tracing API re-exported, for spans you want to add yourself.
- `shutdownTelemetry`, so a short-lived process flushes before exiting.

## Surface

| Import                     | What's in it                             | Runs   |
| -------------------------- | ---------------------------------------- | ------ |
| `@acme/telemetry`          | `initTelemetry`, the tracing API, config | either |
| `@acme/telemetry/server`   | Server-side span helpers                 | server |
| `@acme/telemetry/register` | A side-effect module that initialises    | either |
| `@acme/telemetry/env`      | This package's env factory               | either |

## Wiring

- Call `initTelemetry` from whatever your framework runs before anything else —
  an instrumentation hook, a server plugin, or the top of your entry module.
  Importing `./register` for its side effect does the same thing where you have
  no hook to put a call in.
- Do it in your worker entrypoint too, or background work produces no traces.
- Pass the service name from your app. A shared package cannot know what your
  service is called, so this is a parameter rather than something read from env
  by the package.
- Nothing to thread afterwards. Spans are ambient, so no context object is
  passed to features
  ([ADR 0023](../../../docs/adr/0023-ambient-telemetry-no-context-object.md)).
- Compose the env factory — [env.md](../../../docs/mounting/env.md).

## Env

Both keys are profile-authored config: the service name and the collector
endpoint, each overridable by an environment variable of the same name. See
`src/env.ts`.

## Infra

`jaeger` — an OTLP trace collector. Point the endpoint at your own collector
instead and you need no local service.
