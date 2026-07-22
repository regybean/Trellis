# Chat (`@acme/chat`)

LLM-powered chat interface with streaming responses, persistent history, and RAG over the knowledge base.

## Language

**Conversation**:
A named, persisted sequence of messages between a user and the assistant, identified by a UUID. A user can have many Conversations. Persisted across page reloads. Stored as a Mastra **thread** (`threadId = sessionId`) owned by a **resource** (`resourceId = userId`) — see `@acme/rag`.
_Avoid_: "session", "chat session" (use Conversation in the domain; "thread"/"resource" only when referring to the Mastra storage layer)

**Message**:
A single entry within a Conversation. Has a `role` (`user` | `assistant`) and a `text` body. Stored in the database in order of `timestamp`. The persisted artifact — distinct from the **Turn** that produced it.
_Avoid_: "entry", "line"

**Turn**:
One in-flight generation cycle: a user Message and the assistant Message it spawns, identified by a `turnId`. The unit of generation lifecycle in the decoupled (worker) model — idempotency (`jobId = conversationId:turnId`), the in-flight lock (`chat:inflight:{conversationId}` valued by `turnId`), and abort-scoping (`chat:abort = turnId`) are all keyed on the Turn. At most **one in-flight Turn per Conversation**. A Turn is not persisted as a row; it resolves into (up to) one assistant Message. Contrast: a **Message** is the durable artifact; a **Turn** is the generation that produces it.
_Avoid_: using "turn" loosely for "Message" — a Turn is the live generation, not the stored row.

**`conversationId`** (Mastra alias `sessionId`/`threadId`):
The UUID identifying a Conversation, client-minted before the first Message and required on every procedure. `sessionId` and `threadId` are the **Mastra storage-layer** names for the same value (`threadId = conversationId`); confine them to the chat-memory adapter and Redis key builders — everything above the adapter says `conversationId`.
_Avoid_: "session", "chat session", surfacing `sessionId` above the storage adapter

**Stream**:
The real-time delivery of an assistant Message delta-by-delta as a **Turn** generates. Physically a **Redis Stream** keyed by Conversation (`chatStreamKey(conversationId)`), written by the **Generation worker** and _read_ (not produced) by the `chat.stream` tRPC subscription. The reader re-emits each Redis entry via tRPC `tracked(entryId, event)`, so a reconnecting client resumes from `lastEventId` (SSE `Last-Event-ID`). Entries are **deltas** (`{ chunk }` — the client appends; there is no cumulative `acc`), closed by exactly one **terminal**: `done` (carries the persisted assistant `messageId` — the handle features like feedback key off), `cancelled` (carries `messageId` iff a non-empty partial persisted), or `error` (persists nothing; durable in-stream only through the short post-terminal TTL). After a terminal the stream lives briefly (TTL) then `chat.get` is authoritative.
_Avoid_: "socket", "websocket", "live update", "acc"/"cumulative payload"

**Generation worker**:
A dedicated, always-on Node process — **one per app** (mirroring per-app env / Redis namespace / Postgres schema) — that runs the assistant side of a **Turn**. It drains a BullMQ queue, runs `chatAgent.stream(...)`, `xAdd`s each delta to the **Stream**, and on terminal persists the assistant Message via Mastra Memory. Request-less: it carries no HTTP request, trusts the verified `userId` in the slim job payload, re-stamps `resourceId`, and makes no authorization decision (ownership was asserted at `chat.send`). The runnable process is **app-owned** (`apps/*/worker.ts`); the job _processor_ lives in `@acme/chat`. Generic BullMQ substrate lives in **`@acme/queue`** (the sole `bullmq` home, its own ioredis connection — a sibling to `@acme/redis`, not routed through `nsKey`).
_Avoid_: "background job" (too vague), "server" (it's not an HTTP server)

**In-flight lock**:
A self-expiring Redis key (`chat:inflight:{conversationId}`, `SET NX EX`) whose **value is the `turnId`**, enforcing the _one in-flight Turn per Conversation_ invariant. Set by `chat.send` as its first mutating step (before credits); the **Generation worker renews it as a heartbeat** so the lock doubles as stall-detection and crash-recovery (a dead worker's lock expires and self-heals `chat.send`); deleted in `finally` on terminal. Distinct from BullMQ `jobId` dedup (`conversationId:turnId`), which only collapses duplicate _enqueues_.
_Avoid_: "mutex", "semaphore", conflating it with the BullMQ jobId

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

- A **Conversation** is ensured (create-or-retrieve, idempotent) by the `chat.send` mutation on the first Message — clients do not call `chat.create` separately. `conversationId` is always supplied by the client (a UUID minted before the first Message) and is required.
- A **Turn** is triggered by `chat.send({ query, conversationId, turnId })` (a mutation): it asserts ownership, takes the **In-flight lock** (`SET NX`, valued by `turnId`), ensures the Conversation, persists the **user** Message, consumes credits, and enqueues a **Generation worker** job — then returns. It never streams. Two-tab races return a discriminated result: `{ accepted, turnId }` for the winner, `{ alreadyInflight }` for the loser (which rolls back, attaches, and restores its draft).
- A **Stream** is _read_ (not initiated) by `chat.stream({ conversationId, lastEventId? })` — an always-on, side-effect-free subscription that tails the Redis **Stream** and re-emits deltas + terminal via `tracked()`. The **assistant** Message is generated and persisted by the worker, not by any procedure.
- `chat.stop({ conversationId })` cancels an in-flight Turn (control-plane: publish → worker abort); `chat.reconcileTurn({ conversationId, turnId })` refunds + cleans up an orphaned Turn (idempotent via `chat:refunded:{turnId}`), keeping `chat.stream` pure.
- `chat.get(conversationId)` returns all Messages in a Conversation in order
- `chat.delete(conversationId)` removes the Conversation and all its Messages
- `chat.list()` returns the caller's Conversations as flat summaries (`sessionId`, `title`, `updatedAt`, `folderId`) ordered `updatedAt DESC` — the Conversation History list. The server sorts; the client derives Date Buckets.
- `chat.setFolder(conversationId, folderId)` moves a Conversation into a Folder, or out of one with `folderId: null`
- `chat.folders.list / create / delete` manage Folder definitions, scoped to the caller
- Admin procedures (`adminGet`, `adminList`) can access any user's Conversations

## Design decisions

**Rate limiting**: `chat.send` consumes credits via the `rateLimit()` middleware **at enqueue**, after ownership + In-flight lock but before the worker runs. Exhausted credits produce a `TOO_MANY_REQUESTS` error before any job is enqueued. Credits are **refunded** on a non-`done` terminal that the user didn't choose: the worker refunds on `error`; `chat.reconcileTurn` refunds on orphan (crashed worker). No refund on `done` or `cancelled` (a Stop consumed the partial). All refunds are idempotent via `chat:refunded:{turnId}` (`SET NX`), so the worker and reconcile paths can't double-refund.

**Message persistence is owned by Mastra Memory; the driver moved off `stream`**: persistence stays Mastra-owned, but the _driver_ is now explicit `memory.saveMessages` at two sites, not `stream`'s auto-persist. `chat.send` persists the **user** Message (durable, in `chat.get` before first token); the **Generation worker** recalls context, streams with a read-only memory config, and on terminal persists the **assistant** Message only — `done` → full, `cancelled` → non-empty partial (empty ⇒ nothing), `error` → nothing (an errored partial would poison last-15 recall). The worker also generates+persists the thread title on a Conversation's first Turn (concurrent with the stream, independent of it). Save-before-publish-terminal guarantees `chat.get` includes the `messageId` any client can observe. See chat-local ADRs [0001](docs/adr/0001-stream-owns-message-persistence.md) (superseded), [0002](docs/adr/0002-mastra-memory-owns-conversation-persistence.md) (amended: driver moves off `stream`).

**The chat-memory adapter is the only seam to Mastra Memory**: All thread↔Conversation and stored-message↔Message transforms, plus the Mastra-backed mutations, live in `chat-memory.ts`. The router never imports `memory` directly. The Mastra vocabulary (`thread`, `resource`) is confined to the adapter; everything above speaks Conversation. The agent is called directly — there is no `ChatService` wrapper.

**Ownership is structural, enforced by middleware**: Mastra threads carry no row-level auth, so ownership is seated at the request pipeline by three procedure builders rather than checked per procedure. `ownedConversationProcedure` (used by `create`) loads-and-verifies the Conversation, tolerating an absent thread (injected as `ctx.conversation = null`) since those procedures legitimately run before the thread is stamped. `ownedConversationByIdProcedure` is its durable-stream sibling — identical load-and-verify, but keyed on `conversationId` (the vocabulary `stream`, `send`, `stop`, `reconcileTurn` speak) rather than `sessionId`, and likewise tolerant of an absent thread. `existingConversationProcedure` (used by `get`, `delete`) additionally requires the thread to exist, injecting a non-null `ctx.conversation`. All throw `FORBIDDEN` when `resourceId !== userId`; the existing variant throws `NOT_FOUND` when absent. A procedure cannot touch a Conversation without going through a builder, so an unguarded procedure cannot be written. Credits are no longer consumed on `stream` — the reader is pure — so the credit gate moved to `chat.send`, which asserts ownership before consuming, so a rejected request consumes none. Admin procedures bypass ownership through explicitly-named adapter accessors (`getConversationUnchecked`, `listConversations`). The **Generation worker** is a request-less carve-out: it runs no ownership guard (`assertThreadOwned` can't run — the thread may not exist yet on a first Turn), trusting the verified `userId` carried in the job payload solely to stamp `resourceId` for the one Turn. This is safe because Redis is inside the app's security perimeter (same trust level as Postgres) and `enqueueGenerationTurn` (in `@acme/chat`) is the **sole** authorized enqueuer — `chat.send` asserts ownership before calling it, and adding a second enqueuer is a deliberate edit that must re-satisfy that precondition. See chat-local ADR [0003](docs/adr/0003-conversation-ownership-as-middleware.md) (amended: request-less-executor carve-out).

**The ownership rule _and_ its tRPC mapping both live in `@acme/rag`**: the transport-free rule (`assertThreadOwned`) is in `ownership.ts`; its single tRPC adapter (`assertOwnedThreadForTRPC` / `mapOwnershipError`, from `@acme/rag/ownership-trpc`) is the ONE place a `ThreadOwnershipError` becomes a `FORBIDDEN`. The chat ownership builders and the feedback `submit` mutation both consume the adapter, so a new ownership variant is handled once rather than re-expressed per feature. Absence (a not-yet-stamped thread) is still decided by each caller — `stream`/`create` tolerate `null`; `get`/`delete` and feedback map it to `NOT_FOUND`. `ownership.ts` stays transport-free; `@acme/rag` (shared) depending on `@acme/trpc`'s error type in the adapter module is boundary-legal (shared→platform).

**Message actions are an app-wired render-slot, not a feature dependency**: `ChatAssistant` accepts `renderMessageActions(message)` and renders its result beneath each settled assistant Message. Apps mount per-message UI (e.g. `FeedbackButtons` from `@acme/feedback`) through that slot, so chat never depends on feedback and stays mountable without it. The slot only fires for settled assistant Messages that have a real `id` — which is why the `done` Stream event carries `messageId`.

**Folder storage is split; deletion is lazy**: a Folder _definition_ lives in `chat_folder` (an app-owned, drizzle-kit-managed table re-exported by each app's `db/schema.ts`, like `message_feedback`); the _assignment_ lives on the Mastra thread as `metadata.folderId`, a single scalar so a Conversation is in at most one Folder by construction. Deleting a Folder removes only its row — member threads keep a dangling `folderId` that the client fails to resolve, returning them to their Date Bucket with no per-Conversation write. See [0012](docs/adr/0012-folder-storage-split.md).

**Folder ids are client-minted so create is optimistic**: `chat.folders.create` takes a client-generated `id`, so the sidebar appends the Folder instantly and the server inserts the same id — the row reconciles 1:1 on settle, and a delete issued before the create settles still targets the right id. Every Folder list-mutation (create / delete / setFolder) is optimistic (cancel → snapshot → patch → rollback-on-error → invalidate-on-settle) in `useConversations`.

**Thread titles are auto-generated; the sidebar shows a placeholder until then**: Mastra Memory's `generateTitle` (a cheap `titleModel` from `@acme/models`, falling back to the chat model) names a thread from its first user Message asynchronously. On the first send, `useChat` optimistically prepends the Conversation to the `chat.list` cache titled "New chat" (a resend bumps it to the top with a fresh `updatedAt`), so it appears in the history sidebar immediately; the generated title replaces the placeholder when the list is invalidated on stream settle.

**ChatAssistant is controlled; ConversationView owns navigation**: `ChatAssistant` takes a `sessionId` prop and derives its messages from loaded history (or the greeting for a new Conversation) — no effect copies server data into state. `ConversationView` owns the current sessionId and reconciles the deep-link URL via the History API (`replaceState`, never the framework router — that would remount the segment and tear the SSE stream). The id is cosmetic until the first Message is sent (no DB row / thread / sidebar entry exists before `chat.send`), so the URL only carries it once the Conversation is resumable: a new chat stays on the bare route and is **stamped on first send** (threaded up from `useChat.send`), not on mount; selecting an existing Conversation or a deep link is real/resumable and is stamped immediately, while "New chat" returns the URL to bare. Reconciliation is imperative at those moments — there is no mount effect. It is keyed by sessionId, so resuming a past Conversation deliberately remounts to load history.
