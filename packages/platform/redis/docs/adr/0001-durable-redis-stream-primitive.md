# One durable Redis-stream primitive behind chat / ingest / notifications

**Status:** accepted (ticket #196).

## Context

Three features delivered per-user real-time updates over a Redis Stream — chat's
token stream, ingest's progress stream ([@acme/ingest ADR 0001](../../../../features/ingest/docs/adr/0001-ingest-progress-survives-refresh.md)),
and the notifications stream ([@acme/notifications ADR 0001](../../../../shared/notifications/docs/adr/0001-notifications-seam.md)) — and each
had hand-copied the same transport triplet: an `xRange` poll-loop with idle
backoff, a byte-identical abort-aware `delay(ms, signal)` timer, the same
cursor / `rangeStart` logic, and an encode/parse pair off one zod schema. There
was no shared home, so fixes did not propagate. Two concrete drifts proved the
cost: the `${Date.now()}-0` clock-skew seed that ingest deleted in #194 still
lived in the notifications reader (an app-clock cursor that, under podman-VM
drift, lands in Redis' future and silently drops every live entry), and the
non-atomic `xAdd` + `expire` that ingest replaced with `xAddWithTtl` still lived
in `publish` (a crash between the two can leave the stream immortal).

## Decision

Add **`createDurableStream<T>`** to `@acme/redis` (`durable-stream.ts`) and
migrate all three consumers onto it; delete the per-feature transport files.

1. **The primitive owns the transport, callers own their policy.** It exposes
   `write` (the atomic `xAddWithTtl`), `lastId` (a new `xRevRange` facade op — the
   real Redis-assigned last id), `read` (a decoded full-range fold), and
   `tail(startCursor, { keepGoing?, transform?, pollMinMs, pollMaxMs, signal })` —
   the poll loop, abort-aware `delay`, idle backoff, and exclusive `(cursor`
   resume. Each caller supplies only: a `StreamCodec<T>` (`encode`/`decode` off
   its own zod schema — the primitive folds the raw `[k,v,…]` field array to a
   record first, so the fold is shared); the fresh-connect **cursor-seed policy**
   as `startCursor` (chat = resume-from-`lastEventId`; ingest = snapshot `lastId`;
   notifications = the stream's actual `lastId()`; `HEAD_CURSOR` = the head); and
   optionally `keepGoing(cursor)` (a predicate — `false` takes one more drain then
   closes) and `transform` (a per-batch map/coalesce).

2. **`keepGoing` is the reader's stop signal, injected by the owner.** Chat passes
   its in-flight-Turn lock probe (`readInflightTurn`) here, so the reader stops
   reaching into the Turn control plane itself — the router (which owns that plane)
   injects it, and closes the tail on a terminal by breaking the loop. Ingest and
   notifications pass nothing: they never self-close (client abort only).

3. **`transform` is the reader's per-batch shaping.** Chat passes its
   delta-coalesce (one cold-resume xRange of backlog ⇒ one render); ingest and
   notifications pass nothing (each entry is discrete).

4. **The primitive is zod-agnostic.** It takes `encode`/`decode` functions, not a
   schema, so it depends on no validation library and sidesteps the repo's mixed
   zod v3/v4 usage; each caller runs its own schema inside `decode`.

The poll-loop, cursor policies, `delay`-on-abort, and codec round-trip are tested
**once**, in `@acme/redis` against a real Redis (a new backend suite on its own
logical DB). Each consumer keeps only its own contract tests.

## Consequences

- **Positive.** A stream fix is now written once. The two latent drifts are gone
  everywhere: notifications seeds a fresh cursor from a real Redis id (no
  `Date.now()` cursor survives in the repo), and every consumer writes through the
  atomic `xAddWithTtl`. The `@acme/redis` surface grew by one deliberate,
  documented primitive rather than three copies.
- **Load-bearing seam, named.** `createDurableStream` is now a cross-cutting
  substrate three features depend on; this ADR is where that coupling is written
  down. A fourth consumer adds a codec + seed, not a new poll loop.
- **Accepted — one more `@acme/redis` op.** `xRevRange` is added to the facade
  (superseding @acme/notifications ADR 0001's "no `xRevRange`, no new `@acme/redis` surface"); the
  clock-skew failure it removes is worth the one-method surface growth.
- **Unchanged behaviour.** chat/ingest observable outcomes are identical;
  notifications' leave-and-return still shows nothing (tail-from-now intent
  preserved via the last-id seed).
