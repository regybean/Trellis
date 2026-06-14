# Chat (`@acme/chat`)

LLM-powered chat interface with streaming responses, persistent history, and RAG over the knowledge base.

## Language

**Conversation**:
A named, persisted sequence of messages between a user and the assistant, identified by a UUID. A user can have many Conversations. Persisted across page reloads. Stored as a Mastra **thread** (`threadId = sessionId`) owned by a **resource** (`resourceId = userId`) — see `@acme/rag`.
_Avoid_: "session", "chat session" (use Conversation in the domain; "thread"/"resource" only when referring to the Mastra storage layer)

**Message**:
A single turn within a Conversation. Has a `role` (`user` | `assistant`) and a `text` body. Stored in the database in order of `timestamp`.
_Avoid_: "turn", "entry", "line"

**Stream**:
The real-time delivery of an assistant Message chunk-by-chunk as it is generated. Implemented as a tRPC subscription over SSE. Clients receive `{ type: 'message', chunk, acc, sessionId }` events followed by a `{ type: 'done' }` sentinel.
_Avoid_: "socket", "websocket", "live update"

**RAG** (Retrieval-Augmented Generation):
The pattern where the assistant retrieves relevant Chunks from the knowledge base before generating a response, grounding the answer in operator-uploaded Documents. Implemented agentically: the chat Agent is given a Mastra vector-query tool (`@acme/rag`) and decides when to retrieve.
_Avoid_: "search", "lookup", "context injection"

## Relationships

- A **Conversation** is ensured (create-or-retrieve, idempotent) by the `stream` procedure itself on the first Message — clients do not call `chat.create` separately. `conversationId` is always supplied by the client (a UUID minted before the first Message) and is required.
- A **Stream** is initiated with `chat.stream(query, conversationId)` — the procedure ensures the Conversation exists, saves the user Message, streams the assistant response, then saves the completed assistant Message
- `chat.get(conversationId)` returns all Messages in a Conversation in order
- `chat.delete(conversationId)` removes the Conversation and all its Messages
- Admin procedures (`adminGet`, `adminList`) can access any user's Conversations

## Design decisions

**Rate limiting**: Each `stream` call consumes credits via the `rateLimit()` middleware. Exhausted credits produce a `TOO_MANY_REQUESTS` error before any LLM call is made.

**Message persistence is owned by Mastra Memory**: The `stream` procedure calls `chatAgent.stream(...)` with a memory thread; Mastra Memory (Postgres-backed, in `@acme/rag`) persists both the user turn and the streamed assistant turn — there is no public `save` endpoint and clients never orchestrate writes. A mid-stream error persists no partial assistant turn, leaving the turn retryable. See ADRs [0001](docs/adr/0001-stream-owns-message-persistence.md) (superseded) and [0002](docs/adr/0002-mastra-memory-owns-conversation-persistence.md).

**Ownership is enforced in the procedure**: Mastra threads carry no row-level auth, so `getOwnedThread` checks the thread's `resourceId` against the caller's `userId` — `FORBIDDEN` on mismatch, `NOT_FOUND` when absent.
