# Notifications (`@acme/notifications`)

A generic per-user notification primitive: a background job tells a user "your
work finished," and a toast appears on whatever page they have open. The core
owns the **envelope**, never the **kinds** — a feature adds a notification kind
with zero change here.

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
on the shared `@acme/redis` **Durable stream** primitive — the transport (poll
loop, abort-aware `delay`, atomic append-with-TTL, the `lastId` read) lives there,
not here. What stays local is the wire codec (`payload` JSON ⇄ envelope) and the
**Tail-from-now** seed policy. Rolling 1h TTL, no `MAXLEN`; nothing ever deletes
it. _Avoid_: "queue", "channel", "inbox".

**Tail-from-now**:
The fresh-connect seed policy (`tailNotifications`): seed the cursor to the stream's
**actual last id** (`lastId()` via `xRevRange`), captured eagerly at attach, so the
whole backlog is skipped and only entries published _after_ the reader attaches are
delivered. The seed is always a real Redis-assigned id, never the app clock, which
cannot skew against the ids Redis mints. A leave-and-return therefore shows nothing
— there is **no durability**, and that cost is accepted. _Avoid_: "replay",
"catch-up".

**`toastId` dedup**:
The default renderer passes `toastId: n.id` so react-toastify collapses a
duplicate delivery (StrictMode double-mount, transient reconnect) to one visible
toast — transport-level dedup with zero client state. _Avoid_: "idempotency key".

**Slim `'local'` bleed**:
In the no-auth slim apps, `userId` collapses to the constant `'local'` principal
at the tRPC route seam, so all slim visitors share one `notifications:local`
stream. An accepted cost — the same collapse chat and ingest accept.

## Relationships

- **It needs the app's `QueryClientProvider` above it.** The provider renders its
  own tRPC provider but no `QueryClient`: subscription-only means no queries, so
  there is no `staleTime`, no persister, and nothing it would have configured.
- **It rides `@acme/redis`' Durable stream primitive.** The poll loop, the
  exclusive cursor and the atomic append-with-TTL are that package's; only the
  codec and the seed policy are notifications'.
- **The app owns the `kind`→renderer registry** and mounts the
  `<NotificationsProvider>`, because feature payload schemas are only importable
  at the app. It renders no `<ToastContainer />` of its own.
- **`@acme/hooks` supplies the auth-status gate.** `stream` is a
  `protectedProcedure`, so the tail waits on a resolved signed-in session read
  through `useOptionalAuthStatus`. An app with no `AuthStatusProvider` at all is
  the slim case and stays enabled, since those apps inject a synthetic session
  server-side.

## Decisions

See [`docs/adr/`](docs/adr/).
