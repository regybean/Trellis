# Telemetry is ambient (read from the active OTel span), never threaded through tRPC context

**Status:** accepted

## Context

An earlier design kept a `telemetry` object on the tRPC context: `createTRPCContext`
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
  This removes the `BaseContext`-typing blocker the placeholder existed for — with no generic
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

**Each app initialises the OTel SDK at its own server boundary.** The Next.js apps
keep an `instrumentation.ts` preload, which gives full HTTP auto-instrumentation;
the TanStack apps call `initTelemetry()` from a Nitro startup plugin, which is
loader-free and runs identically in dev and prod. `service.name` is a per-app
literal (`trellis-nextjs`, `trellis-tanstack-start`, …) — app identity, not shared
config. The platform never assumes a framework established an ambient span: the
per-procedure span is simply parentless when none exists.

A TanStack trace is therefore rooted at the tRPC procedure span rather than an HTTP
one, and lacks auto redis/aws/outgoing-HTTP spans; DB spans are unaffected either
way, since they come from manual `instrumentDrizzleClient`. The escalation path to
HTTP-parent parity is the pre-built side-effecting `@acme/telemetry/register`
entry — preload it with `NODE_OPTIONS="--import @acme/telemetry/register"` and
auto-instrumentation patches the runtime before the server graph loads. Additive,
no rework of the seam.

## Consequences

- Per-app SDK init (`instrumentation.ts` / Nitro plugin) is unchanged; the noop
  fallback added for tanstack-start's missing ambient span is no longer
  needed, because context creation no longer builds a telemetry object.
- Telemetry becomes invisible in domain code at the cost of a little signal
  (per-router domain counts, validation-schema tags) — an accepted trade.
- If a future need arises to trace work done _during_ context creation (before the
  procedure span is active, e.g. `entitlements.resolve`), it needs its own span —
  it can no longer piggyback on a context-level telemetry object.

## Amendment (#264) — the telemetry middleware is now wired per feature

The decision is unchanged: telemetry is ambient, nothing reads `ctx.telemetry`,
and the per-procedure span is created and activated by one middleware that
everything else reads through `trace.getActiveSpan()`.

What moved is where that middleware is _wired_. `@acme/trpc` no longer builds a
tRPC instance at all — it exports `withProcedureSpan`, the plain async helper that
owns the span lifecycle, and each feature wraps it in a one-line `t.middleware`
against its own concrete context. Same span name, same attributes, same ordering
(telemetry first, so every later middleware has an active span to write to); the
`initTRPC` call it is attached to is the feature's now.

The "concrete-context blocker" behind that placeholder is doubly dead: with
no `ctx.telemetry` there is nothing to type, and with #264 there is no generic
context left to type it against. See the
[#264 amendment to ADR 0006](0006-entitlements-injection-seam.md).
