# Telemetry is initialized per-app at the server boundary; the platform assumes no ambient span

Adding `apps/tanstack-start` alongside `apps/nextjs` exposed that telemetry was
coupled to Next. `@acme/trpc`'s `createTRPCContext` called
`createTelemetryContext()`, which **threw** `"No active span found"` whenever
`trace.getActiveSpan()` was empty. It only ever worked because Next's
`instrumentation.ts` preloads `getNodeAutoInstrumentations()`, so every request
already had an ambient HTTP span. TanStack Start (Vite + Nitro) starts no SDK, so
that base object threw and every tRPC call (chat/billing/ingest) failed. Two
decisions are load-bearing:

1. **The platform no longer assumes a framework established an ambient span.**
   `createTelemetryContext()` returns a true no-span noop `Telemetry` instead of
   throwing. The base object was always a throwaway placeholder — `telemetryMiddleware`
   creates the real per-procedure span (`trpc.<path>`, parentless if no ambient
   span) and overrides `ctx.telemetry`. The placeholder is kept (not deleted) so
   `BaseContext` stays concrete and the four reusable middlewares
   (`isAuthed`/`isAdmin`/`rateLimit`/`requireTier`), which read `ctx.telemetry` and
   are typed on the root context, need no change — preserving the deliberate
   concrete-context design.

2. **Each app initializes the OTel SDK at its own server boundary.** `apps/nextjs`
   keeps its `instrumentation.ts` preload (full HTTP auto-instrumentation).
   `apps/tanstack-start` calls `initTelemetry()` in a Nitro startup plugin — the
   per-app half of the telemetry seam, mirroring the per-app _Clerk resolver_
   (ADR-0003). `service.name` is per app: `trellis-nextjs` / `trellis-tanstack-start`.

## Status

superseded by [ADR 0022](0022-ambient-telemetry-no-context-object.md) — the
per-app SDK-init seam (decision 2) still holds; the context-threaded `telemetry`
placeholder (decision 1) is removed in favour of ambient `trace.getActiveSpan()`.

## Considered and rejected

- **`NODE_OPTIONS=--import` preload for tanstack-start** (full auto-instrumentation
  parity — HTTP parent span, outgoing HTTP, redis, aws). Rejected for now:
  `@acme/telemetry` exports raw TS and the repo ships no TS loader (`tsx`/`ts-node`),
  so a preload needs a compiled-JS/loader entry; and TanStack Start's own OTel guide
  is explicitly experimental and blesses no loader mechanism. The Nitro plugin is
  loader-free and runs identically in dev and prod.
- **Deleting the base telemetry placeholder entirely.** Cleaner in principle, but
  `BaseContext = ReturnType<typeof createTRPCContext>` types the four reusable
  middlewares that read `ctx.telemetry`; removing it cascades type errors and forces
  a telemetry-augmented context generic — the exact middleware conditional-type
  explosion the concrete-context design avoids.

## Consequences

- tanstack-start traces are **rooted at the tRPC procedure span**, not an HTTP span,
  and lack auto redis/aws/outgoing-HTTP spans. DB spans are unaffected — they come
  from manual `instrumentDrizzleClient` (`@kubiks/otel-drizzle`), whose deferred
  proxy tracer resolves once the plugin registers the provider before the first
  request.
- Escalation path for full HTTP-parent parity: the side-effecting
  `@acme/telemetry/register` entry is pre-built. Preload it via
  `NODE_OPTIONS="--import @acme/telemetry/register"` on the tanstack `dev`/`start`
  scripts to patch auto-instrumentation before the server graph loads — additive,
  no rework of the seam. It reads `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_ENDPOINT`
  from the environment.
- The Nitro plugin also carries the other boot-time concerns Next does in
  `instrumentation.ts` — provider resolution (`import('@acme/models')`) and
  `ensureVectorIndex()` — so both apps fail fast at startup on a missing selected-
  provider env or an unreachable vector DB, rather than on the first request.
