# The stream procedure owns Message persistence; clients never orchestrate writes

The `chat.stream` procedure is the single owner of every Conversation write: on the
first Message it ensures the `chats` row exists (idempotent create-or-retrieve) and
saves the user Message in one transaction before any LLM call, then saves the
completed assistant Message on clean stream completion. We removed the client-side
orchestration (a `lastSavedMessageRef` de-dupe hack in `use-chat.ts` that inferred
"assistant Message complete" from a subscription idle event and fired a `save`
mutation) and deleted the public `chat.save` endpoint entirely.

## Status

accepted

## Why

The previous design split persistence across the wire: the user Message and
Conversation creation were fired client-side, and the assistant Message was saved by
the client after the stream went idle. This had no transactional locality — if the
client dropped between stream-end and the save mutation, the assistant Message was
lost — and the save/stream/save sequence could not be tested through the procedure.
It also contradicted this package's own CONTEXT.md, which already documented
persistence as living inside the procedure.

## Considered and rejected

- **Client keeps calling `chat.create`, stream only saves Messages.** The stream's
  first insert would still depend on the client's `create` having committed first —
  the same cross-wire race, just moved. Rejected: doesn't achieve locality.
- **Keep a public `chat.save` endpoint.** A public "persist an arbitrary Message"
  procedure reopens the exact door this change closes — any caller could write
  Messages out-of-band and re-create the split-brain. Rejected: the explicit _no_ is
  the point.

## Consequences

- `ChatRequest.sessionId` is now required (the client mints the UUID before the first
  Message); the `?? 'placeholder'` / `?? ''` fallbacks are gone.
- A mid-stream LLM error persists no partial assistant Message, leaving the turn
  retryable (the user Message is already durable).
- `ensureChat` is extracted from `create` and reused by both `create` and `stream`;
  the dead `getChat` service method is removed.
