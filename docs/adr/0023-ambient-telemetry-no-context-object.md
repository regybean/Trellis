# Telemetry is ambient (read from the active OTel span), never threaded through tRPC context

Supersedes [ADR 0005](0005-telemetry-init-seam.md).

## Context

ADR 0005 kept a `telemetry` object on the tRPC context: `createTRPCContext`
built a throwaway placeholder (a non-recording noop span when no ambient span
existed) that `telemetryMiddleware` immediately overwrote with the real
per-procedure span. The placeholder existed **only** to keep `BaseContext`
concrete so the four reusable middlewares (`isAuthed`/`isAdmin`/`rateLimit`/
`requireTier`) that read `ctx.telemetry` would type-check without a
telemetry-generic context.

That threaded `telemetry` object leaked into domain code: ~73 `ctx.telemetry.set/
.event` calls across feature routers, a bespoke `makeTelemetry` wrapper
(`set`/`event`/`withSpan`/`parseWithTelemetry`) layered over OTel, and — worst —
an optional `telemetry?: Telemetry` parameter threaded through `@acme/billing`'s
Stripe utils with an `if (telemetry) { … } else { … }` branch at every call site.

## Decision

**There is no `telemetry` on the tRPC context.** `telemetryMiddleware` remains the
sole span source: it creates and _activates_ the per-procedure span
(`trpc.<path>` with path/type/user.id/status/duration/exceptions) in OTel context.
Everything else reads that span **ambiently** via `trace.getActiveSpan()`:

- The reusable middlewares emit their events through the active span, not `ctx`.
  This removes the `BaseContext`-typing blocker ADR 0005 cited — with no generic
  and no conditional-type explosion — because nothing reads `ctx.telemetry`.
- `@acme/telemetry` exports two ambient, ctx-free helpers: `withSpan(name, fn, opts?)`
  (child span with error handling, under `context.active()`) and
  `setSpanAttributes(attrs)`. `makeTelemetry`, `createTelemetryContext`, and
  `createProcedureTelemetry` are deleted along with the placeholder.
- `@acme/billing`'s utils drop the `telemetry?` parameter and all `if (telemetry)`
  branches, calling the ambient helpers directly.
- Feature **routers reference telemetry nowhere**. Redundant `user.id` tags were
  already set automatically by the middleware; bespoke domain attributes
  (`result.chatCount`, etc.) and the `validation.schema` tag from
  `parseWithTelemetry` are intentionally dropped — plain `schema.parse()` is used,
  and the middleware's catch still records thrown errors as span exceptions.

Enforcement is by removal, not lint: with nothing on the context, router code has
nothing to call.

## Consequences

- Per-app SDK init (`instrumentation.ts` / Nitro plugin) is unchanged; the noop
  fallback that ADR 0005 added for tanstack-start's missing ambient span is no
  longer needed, because context creation no longer builds a telemetry object.
- Telemetry becomes invisible in domain code at the cost of a little signal
  (per-router domain counts, validation-schema tags) — an accepted trade.
- If a future need arises to trace work done _during_ context creation (before the
  procedure span is active, e.g. `entitlements.resolve`), it needs its own span —
  it can no longer piggyback on a context-level telemetry object.
