# Notifications (`@acme/notifications`)

A generic per-user notification primitive: a background job tells a user "your
work finished," and a toast appears on whatever page they have open. The first
`shared` package to own a tRPC router and a cross-cutting per-user subscription
(see [ADR 0030](../../../docs/adr/0030-notifications-seam.md)). Ingest (spec #185)
is its first consumer; the primitive is the durable win.

The core owns the **envelope**, never the **kinds** — a feature adds a
notification kind with zero change here.

## Layout

- `./schema` (isomorphic) — the envelope zod schema + types.
- `./server` (`server-only`) — `publish` (the sole writer), the `appRouter`, and
  `createTRPCContext`. A worker/server importing this never pulls the `'use
client'` React connectors.
- `.` (client) — the `<NotificationsProvider>` an app mounts, plus
  `dispatchNotification` + `defaultToastRenderer` for assembling a `renderers` map.

## Language

**Notification**:
The unit of delivery: one `{ id, kind, level, message, createdAt, data? }`
envelope, written to a user's stream by `publish` and rendered as one toast.
_Avoid_: "message" (that's the envelope's text field), "event".

**Envelope**:
The open, toast-shaped notification shape the **core owns**. `id` + `createdAt`
are server-minted; `kind` and `data` are consumer-defined. _Avoid_: "payload"
(that's the single Redis stream field the envelope is serialised into).

**Kind**:
An **open dispatch/telemetry string** (e.g. `ingest.job-complete`), keyed on by
the app's `renderers` registry. Dotted `feature.event` form (colon is reserved for
`nsKey` Redis segments). Not a closed enum — `shared` can't import feature payload
types. _Avoid_: "type", "event name".

**Level**:
The toast severity — a **closed** enum `info | success | error`, mapped 1:1 onto
`toast.info|success|error` by the default renderer. (Closed even though `kind` is
open.) _Avoid_: "severity", "variant".

**`data`**:
An **opaque** per-kind escape hatch (`Record<string, unknown>`). The core never
reads it; a custom renderer zod-parses its own `data` at the top of the function.
_Avoid_: "props", "meta".

**Renderer**:
A `(n: Notification) => void` that turns one notification into a side effect
(a toast). The **app** assembles the `kind`→renderer registry; an unregistered
kind falls through to `defaultToastRenderer`. _Avoid_: "handler", "component".

**`publish(userId, input)`**:
The **sole writer**. Mints `id`/`createdAt`, validates, then hands the envelope to
the **Notification stream** — which encodes it as a single `payload` JSON field and
appends it with an atomically-restamped rolling 1h TTL. _Avoid_: "emit", "send".

**Notification stream** (`notification-stream.ts`):
The per-user stream at `notificationKey(userId) = nsKey('notifications', userId)`,
on the shared `@acme/redis` **Durable stream** primitive (#196) — the transport
(poll loop, abort-aware `delay`, atomic append-with-TTL, the `lastId` read) lives
there, not here. What stays local is the wire codec (`payload` JSON ⇄ envelope) and
the **Tail-from-now** seed policy. Rolling 1h TTL, no `MAXLEN`; nothing ever deletes
it. _Avoid_: "queue", "channel", "inbox".

**Tail-from-now**:
The fresh-connect seed policy (`tailNotifications`): seed the cursor to the stream's
**actual last id** (`lastId()` via `xRevRange`), captured eagerly at attach, so the
whole backlog is skipped and only entries published _after_ the reader attaches are
delivered. A leave-and-return therefore shows nothing (no durability — accepted,
ADR 0030). _Fixed (#196)_: the seed was `${Date.now()}-0` — the app clock, while
Redis assigns ids from its own; under podman-VM drift that landed in Redis' future
and silently dropped live entries (the same skew class ingest's #194 killed). A real
Redis id can't skew; a regression test injects skew and asserts delivery. _Avoid_:
"replay", "catch-up".

**`toastId` dedup**:
The default renderer passes `toastId: n.id` so react-toastify collapses a
duplicate delivery (StrictMode double-mount, transient reconnect) to one visible
toast — transport-level dedup with zero client state. _Avoid_: "idempotency key".

**Slim `'local'` bleed**:
In the no-auth slim apps, `userId` collapses to the constant `'local'` principal
at the tRPC route seam, so all slim visitors share one `notifications:local`
stream. Accepted and documented (ADR 0030) — the same collapse chat/ingest accept.
