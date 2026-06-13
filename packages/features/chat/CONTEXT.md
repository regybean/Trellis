# Chat (`@acme/chat`)

LLM-powered chat interface with streaming responses, persistent history, and RAG over the knowledge base.

## Language

**Conversation**:
A named, persisted sequence of messages between a user and the assistant, identified by a UUID. A user can have many Conversations. Persisted across page reloads.
_Avoid_: "session", "thread", "chat session"

**Message**:
A single turn within a Conversation. Has a `role` (`user` | `assistant`) and a `text` body. Stored in the database in order of `timestamp`.
_Avoid_: "turn", "entry", "line"

**Stream**:
The real-time delivery of an assistant Message chunk-by-chunk as it is generated. Implemented as a tRPC subscription over SSE. Clients receive `{ type: 'message', chunk, acc, sessionId }` events followed by a `{ type: 'done' }` sentinel.
_Avoid_: "socket", "websocket", "live update"

**RAG** (Retrieval-Augmented Generation):
The pattern where the assistant retrieves relevant Chunks from the knowledge base before generating a response, grounding the answer in operator-uploaded Documents. Handled by `@acme/llamaindex`.
_Avoid_: "search", "lookup", "context injection"

## Relationships

- A **Conversation** is ensured (create-or-retrieve, idempotent) by the `stream` procedure itself on the first Message — clients do not call `chat.create` separately. `conversationId` is always supplied by the client (a UUID minted before the first Message) and is required.
- A **Stream** is initiated with `chat.stream(query, conversationId)` — the procedure ensures the Conversation exists, saves the user Message, streams the assistant response, then saves the completed assistant Message
- `chat.get(conversationId)` returns all Messages in a Conversation in order
- `chat.delete(conversationId)` removes the Conversation and all its Messages
- Admin procedures (`adminGet`, `adminList`) can access any user's Conversations

## Design decisions

**Rate limiting**: Each `stream` call consumes credits via the `rateLimit()` middleware. Exhausted credits produce a `TOO_MANY_REQUESTS` error before any LLM call is made.

**Message persistence is inside the stream procedure**: The user message and the completed assistant message are both saved by the `stream` procedure itself — there is no public `save` endpoint and clients never orchestrate writes. The Conversation row is ensured and the user Message saved in a single transaction before any LLM call; the assistant Message is saved only on clean stream completion (a mid-stream error persists no partial assistant Message, leaving the turn retryable).
