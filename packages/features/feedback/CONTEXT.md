# Feedback (`@acme/feedback`)

Thumbs-up/down feedback on individual assistant Messages. The first app-owned,
Drizzle-managed table in the repo — an app table annotating Mastra-owned
identifiers with no foreign key.

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
owns that DDL at runtime, so integrity across the seam is enforced in the router,
not by Postgres. _Avoid_: "foreign key", "join column"

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

## Decisions

See [`docs/adr/`](docs/adr/).
