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
The real-time delivery of an assistant Message chunk-by-chunk as it is generated. Implemented as a tRPC subscription over SSE. Clients receive `{ type: 'message', chunk, acc, sessionId }` events followed by a `{ type: 'done', sessionId, messageId }` sentinel. The `done` event carries the persisted assistant `messageId` (or `null` if it could not be resolved) so clients can stamp the settled Message with its real id — the handle other features (e.g. feedback) key off.
_Avoid_: "socket", "websocket", "live update"

**RAG** (Retrieval-Augmented Generation):
The pattern where the assistant retrieves relevant Chunks from the knowledge base before generating a response, grounding the answer in operator-uploaded Documents. Implemented agentically: the chat Agent is given a Mastra vector-query tool (`@acme/rag`) and decides when to retrieve.
_Avoid_: "search", "lookup", "context injection"

**Conversation History**:
The user-facing surface for revisiting past Conversations. A sidebar lists a user's Conversations grouped into **Folders** first, then **Date Buckets**. Selecting a Conversation resumes it (loads its Messages and streams new turns into the same thread).
_Avoid_: "chat log", "session list"

**Folder**:
A user-created, named grouping of Conversations, owned by a user. A Conversation belongs to **at most one** Folder at a time (exclusivity). Folder _definitions_ (name, owner) are app-owned rows; the _assignment_ lives in the Conversation's Mastra thread `metadata.folderId`. Deleting a Folder returns its Conversations to their Date Bucket (the dangling `folderId` no longer resolves — no per-Conversation write).
_Avoid_: "category", "label", "tag" (a Conversation is in one Folder, not many)

**Date Bucket**:
A derived (not stored) grouping of un-foldered Conversations by last activity (`updatedAt`): **Today** (since local midnight), **This week** (last 7 days), **Older** (everything before). Computed client-side from the flat Conversation list.
_Avoid_: "archive" as a verb/action — there is no archive action, only the time-derived "Older" bucket.

## Relationships

- A **Conversation** is ensured (create-or-retrieve, idempotent) by the `stream` procedure itself on the first Message — clients do not call `chat.create` separately. `conversationId` is always supplied by the client (a UUID minted before the first Message) and is required.
- A **Stream** is initiated with `chat.stream(query, conversationId)` — the procedure ensures the Conversation exists, saves the user Message, streams the assistant response, then saves the completed assistant Message
- `chat.get(conversationId)` returns all Messages in a Conversation in order
- `chat.delete(conversationId)` removes the Conversation and all its Messages
- Admin procedures (`adminGet`, `adminList`) can access any user's Conversations

## Design decisions

**Rate limiting**: Each `stream` call consumes credits via the `rateLimit()` middleware. Exhausted credits produce a `TOO_MANY_REQUESTS` error before any LLM call is made.

**Message persistence is owned by Mastra Memory**: The `stream` procedure calls `chatAgent.stream(...)` with a memory thread; Mastra Memory (Postgres-backed, in `@acme/rag`) persists both the user turn and the streamed assistant turn — there is no public `save` endpoint and clients never orchestrate writes. A mid-stream error persists no partial assistant turn, leaving the turn retryable. See ADRs [0001](docs/adr/0001-stream-owns-message-persistence.md) (superseded) and [0002](docs/adr/0002-mastra-memory-owns-conversation-persistence.md).

**The chat-memory adapter is the only seam to Mastra Memory**: All thread↔Conversation and stored-message↔Message transforms, plus the Mastra-backed mutations, live in `chat-memory.ts`. The router never imports `memory` directly. The Mastra vocabulary (`thread`, `resource`) is confined to the adapter; everything above speaks Conversation. The agent is called directly — there is no `ChatService` wrapper.

**Ownership is structural, enforced by middleware**: Mastra threads carry no row-level auth, so ownership is seated at the request pipeline by two procedure builders rather than checked per procedure. `ownedConversationProcedure` (used by `stream`, `create`) loads-and-verifies the Conversation, tolerating an absent thread (injected as `ctx.conversation = null`) since those procedures legitimately run before the thread is stamped. `existingConversationProcedure` (used by `get`, `delete`) additionally requires the thread to exist, injecting a non-null `ctx.conversation`. Both throw `FORBIDDEN` when `resourceId !== userId`; the existing variant throws `NOT_FOUND` when absent. A procedure cannot touch a Conversation without going through a builder, so an unguarded procedure cannot be written. Ownership runs _before_ rate limiting on `stream`, so a rejected request consumes no credits. Admin procedures bypass ownership through explicitly-named adapter accessors (`getConversationUnchecked`, `listConversations`). See [0003](docs/adr/0003-conversation-ownership-as-middleware.md).

**The ownership rule itself lives in `@acme/rag`**: the builders call `assertThreadOwned(threadId, userId)` from `@acme/rag` rather than reading `resourceId` inline. The thread-ownership fact has one definition, reused by the feedback feature's `submit` mutation — a feature that annotates Mastra data inherits the rule instead of copying it.

**Message actions are an app-wired render-slot, not a feature dependency**: `ChatAssistant` accepts `renderMessageActions(message)` and renders its result beneath each settled assistant Message. Apps mount per-message UI (e.g. `FeedbackButtons` from `@acme/feedback`) through that slot, so chat never depends on feedback and stays mountable without it. The slot only fires for settled assistant Messages that have a real `id` — which is why the `done` Stream event carries `messageId`.
