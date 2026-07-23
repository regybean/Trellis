# Feedback (`@acme/feedback`)

Thumbs-up/down feedback on individual assistant Messages. The first app-owned,
Drizzle-managed table in the repo — the worked example of the ADR-0002 ownership
seam, where an app table annotates Mastra-owned identifiers with no foreign key.

## Language

**Feedback**:
A single user's verdict on one assistant **Message**, identified by `(userId,
messageId)`. Holds a **Rating** and an optional free-text **comment**. At most one
Feedback exists per user per Message — submitting again replaces it (an upsert).
_Avoid_: "rating row", "vote", "reaction"

**Rating**:
The verdict itself — `up` or `down`. A Postgres enum (`feedback_rating`). Clicking
the active Rating again clears the Feedback (toggle off).
_Avoid_: "score", "thumbs", "sentiment"

**Message reference**:
The Mastra-owned `messageId` (and its `threadId`) a Feedback points at, carried by
value. The feedback table holds **no foreign key** to `mastra_messages` — Mastra
owns that DDL at runtime (ADR-0002), so integrity across the seam is enforced in the
router, not by Postgres. _Avoid_: "foreign key", "join column"

## Relationships

- `feedback.submit({ messageId, threadId, rating, comment? })` upserts the caller's
  Feedback for a Message. It runs the **ownership seam** in order: (1) the thread must
  be owned by the caller — `assertThreadOwned` from [`@acme/rag`](../../shared/rag/CONTEXT.md),
  mapped to `FORBIDDEN`/`NOT_FOUND`; (2) the Message must exist in that thread — read
  from the `mastra_messages` Drizzle mirror, else `NOT_FOUND`; (3) the row is upserted
  on the `(message_id, user_id)` unique constraint.
- `feedback.forMessage({ messageId })` returns the caller's Feedback for a Message
  (zero or one), filtered by `userId` so a caller only ever reads their own.
- `feedback.remove({ messageId })` clears the caller's Feedback (the toggle-off path).
- The UI is the `FeedbackButtons` component, mounted by an app through the chat
  feature's `renderMessageActions` render-slot — **chat never depends on
  `@acme/feedback`**. The app supplies `messageId` (from the chat `done` stream event)
  and `threadId` (the Conversation's `sessionId`).

## Design decisions

**App-owned table, no foreign key across the Mastra seam**: `message_feedback` is
defined here but re-exported through each app's `db/schema.ts` so drizzle-kit owns its
DDL, while Mastra owns the `mastra_*` tables it references. The two ownership lanes
never cross with a database constraint; integrity is enforced in the `submit` router
(thread owned + message exists) instead. This is the concrete proof of [ADR 0002](../../../docs/adr/0002-mastra-rag-and-memory.md)'s
app-owned lane and is documented in its own [ADR 0001](docs/adr/0001-feedback-references-mastra-ids-without-fk.md).

**Ownership reuses the shared rule**: `submit` does not re-derive thread ownership; it
calls `assertThreadOwned` from `@acme/rag`, the same rule chat's middleware uses. A
feature that annotates Mastra data inherits the ownership definition rather than
copying it.

**Feedback is per-user and self-scoped**: every read and write filters by the
authenticated `userId`. There is no cross-user read; admins are not a concern of this
feature. One row per `(user, message)` is a DB-level unique constraint, so `submit` is
idempotent.

**The chat feature exposes a render-slot, not a feedback dependency**: chat renders
whatever `renderMessageActions(message)` returns beneath a settled assistant Message.
Apps wire `FeedbackButtons` into that slot. Keeping the dependency app-side preserves
the slice contract — chat stays mountable without feedback, and a reduced-subset app
can omit feedback entirely.

**Rating state persists for instant / offline read (opt-in)**: `feedback.forMessage`
is marked persistable via `meta: persistMeta`, so its Rating renders immediately on
reload — including offline — instead of flickering in once the network responds. The
mechanism is the shared per-query IndexedDB persister from `@acme/hooks` ([ADR 0025](../../../docs/adr/0025-per-query-indexeddb-persister.md)),
composed into feedback's own query client under storage key `rq-feedback`; each
per-Message query is written under its own hash, lazily and asynchronously, so many
Messages never rewrite a whole-cache blob or jank the main thread. `forMessage` is the
only persisted query — the `submit`/`remove` mutations never are.

**Persistence is opt-in and auth-agnostic**: `FeedbackTRPCReactProvider` accepts an
app-supplied `scopeKey` (the signed-in user id via the `@acme/auth` seam in full apps,
`'anon'` in slim apps — the feature never imports Clerk). Absent a `scopeKey`, or where
IndexedDB is unavailable, the feature runs network-only exactly as before; persistence
is a pure read-time optimisation, never a hard dependency. The persister `buster` is
`FEEDBACK_PERSIST_VERSION:scopeKey`, so a different user or an incompatible data-shape
version never rehydrates a prior snapshot. `maxAge` is 24h (`gcTime` matches). The
provider surface exports `clearPersistedCache()`, which the full apps call alongside
`queryClient.clear()` on logout to wipe Rating state on shared machines.
