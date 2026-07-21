# Mastra Memory owns Conversation persistence; the procedure orchestrates a thread

The `chat.stream` procedure no longer writes Conversation rows itself. It calls
`chatAgent.stream(prompt, { memory: { thread: sessionId, resource: userId } })`
and Mastra Memory (backed by `PostgresStore`) persists both the user turn and the
streamed assistant turn as a side effect. A Conversation is a Mastra **thread**
(`threadId = sessionId`) owned by a **resource** (`resourceId = userId`); the read
procedures (`get`, `delete`, `create`, `adminGet`, `adminList`) call the Memory API
(`recall`, `deleteThread`, `createThread`, `getThreadById`, `listThreads`) rather
than Drizzle. The `chats`/`messages` tables and all hand-written persistence are
gone.

## Status

accepted (supersedes [0001-stream-owns-message-persistence](0001-stream-owns-message-persistence.md))

## Why

Migrating RAG from LlamaIndex to Mastra brought Mastra Memory, which already does
exactly what ADR-0001 built by hand: durable, transactionally-local persistence of
both turns behind the streaming call, with no client orchestration. Reusing it
deletes our bespoke persistence code (the `ensureChat`/save plumbing) and keeps the
conversation store consistent with the agent that produces it. Keeping our own
tables alongside Mastra's would mean writing every message twice and reconciling two
sources of truth.

## Considered and rejected

- **Keep the Drizzle `chats`/`messages` tables, sync from Mastra.** Two writes per
  turn and a reconciliation burden, for no gain — Mastra's tables already hold the
  same data. Rejected.
- **Wrap Mastra Memory writes in our own tRPC transaction.** Mastra owns the write
  lifecycle inside `agent.stream`; re-wrapping it re-introduces the cross-call race
  ADR-0001 removed. Rejected — let the framework own the unit of work.

## Consequences

- Ownership is enforced in the procedure, not the database: `getOwnedThread`
  compares the thread's `resourceId` to the caller's `userId` and throws `FORBIDDEN`
  on mismatch / `NOT_FOUND` when absent (Mastra threads carry no row-level auth).
- The wire contract (`StreamChatEvent`) is unchanged — clients see the same events.
- Conversations are queryable with Drizzle via the mirrored `mastra_threads` /
  `mastra_messages` tables in `@acme/rag/schema`, but those mirrors are read models;
  Mastra owns the DDL and the writes (see system ADR
  [0002-mastra-rag-and-memory](../../../../../docs/adr/0002-mastra-rag-and-memory.md)).
- A mid-stream LLM error still leaves the turn retryable — Mastra persists the user
  turn before generation.

## Amendment — the driver moved off `stream` (durable-chat-stream, T5)

The mechanism above — Mastra Memory persisting the assistant turn as a **side
effect of `agent.stream` inside the `chat.stream` procedure** — no longer holds.
The durable-chat-stream work (spec #44) decoupled generation from the client
connection, and with it moved persistence off the reader:

- `chat.stream` is now a **pure, stateless reader** (`tailChatStream`): it tails
  the Conversation's Redis Stream and re-emits each entry via tRPC `tracked()`.
  It runs no `chatAgent.stream`, persists nothing, and takes no locks.
- The **Generation worker** (`chatGenerationProcessor`) is the sole driver of
  `chatAgent.stream`, and it runs with a **read-only** memory config so Mastra
  does _not_ auto-persist. The worker persists the assistant Message with an
  **explicit `memory.saveMessages`** on terminal: `done` → full text;
  `cancelled` → non-empty partial only; `error` → nothing. See chat-local ADR
  0004 (generation worker & queue).
- The wire contract is no longer `StreamChatEvent`. The reader emits a
  discriminated `StreamReaderEvent` (`delta` / `done` / `cancelled` / `error`),
  each Redis entry re-emitted under its Stream entry id as the SSE
  `Last-Event-ID`.

What survives from the original decision: Mastra Memory still owns the
Conversation store and its DDL, ownership is still enforced in the procedure
(now via `ownedConversationByIdProcedure`), and there is still no public `save`
endpoint. What changed is _who_ calls `saveMessages` and _when_ — the worker, on
terminal, explicitly — rather than the streaming procedure implicitly.
