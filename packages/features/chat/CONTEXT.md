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
The real-time delivery of an assistant Message delta-by-delta as a **Turn** generates. Physically a **Redis Stream** keyed by Conversation (`chatStreamKey(conversationId)`), on the shared `@acme/redis` **durable-stream** primitive — chat's `chat-stream.ts` supplies only its own codec, delta-coalesce `transform`, and terminal predicate; the transport (poll loop, abort-aware `delay`, atomic append-with-TTL, exclusive resume cursor) lives in `@acme/redis`. Produced through the **Stream writer** (driven by the **Generation worker**) and _read_ (not produced) by the `chat.stream` tRPC subscription, which tails the primitive and re-emits each entry via tRPC `tracked(entryId, event)`, so a reconnecting client resumes from `lastEventId` (SSE `Last-Event-ID`). Entries are **deltas** (`{ chunk }` — the client appends; there is no cumulative `acc`), closed by exactly one **terminal**: `done` (carries the persisted assistant `messageId` — the handle features like feedback key off), `cancelled` (carries `messageId` iff a non-empty partial persisted), or `error` (persists nothing; durable in-stream only through the short post-terminal TTL). After a terminal the stream lives briefly (TTL) then `chat.get` is authoritative.
_Avoid_: "socket", "websocket", "live update", "acc"/"cumulative payload"

**Stream writer**:
The producer half of the **Stream** (`chat-stream.ts`), symmetric to the reader: the **sole appender** and the single producer of the shared stream-event wire shape. Exposes intent-named operations — `delta(chunk)`, `done(messageId)`, `cancelled(messageId | null)`, `error()` — so the **Generation worker** expresses its terminal policy without hand-building wire fields. `encodeEvent` is the pure inverse of `decodeEvent`; both are typed off the one `streamReaderEventSchema`, so a wire-shape change is a two-file edit the type checker enforces. The safety TTL is (re)stamped atomically on every append (the primitive's `xAddWithTtl`), so a crashed worker can't leave a dangling key; the post-terminal shortening stays in `settleTurn` (the Turn control plane). The **reader** half no longer reaches into the Turn control plane: the `chat.stream` router injects `readInflightTurn` as the primitive's `keepGoing` lock probe and breaks the tail on a terminal — the reader is pure transport + policy.
_Avoid_: appending to the Stream anywhere else; hand-constructing terminal fields in the worker.

**Generation worker**:
A dedicated, always-on Node process — **one per app** (mirroring per-app env / Redis namespace / Postgres schema) — that runs the assistant side of a **Turn**. It drains a BullMQ queue, runs `chatAgent.stream(...)`, `xAdd`s each delta to the **Stream**, and on terminal persists the assistant Message via Mastra Memory. Request-less: it carries no HTTP request, trusts the verified `userId` in the slim job payload, re-stamps `resourceId`, and makes no authorization decision (ownership was asserted at `chat.send`). The runnable process is **app-owned** (`apps/*/worker.ts`); the job _processor_ lives in `@acme/chat`. Generic BullMQ substrate lives in **`@acme/queue`** (the sole `bullmq` home, its own ioredis connection — a sibling to `@acme/redis`, not routed through `nsKey`).
_Avoid_: "background job" (too vague), "server" (it's not an HTTP server)

**In-flight lock**:
A self-expiring Redis key (`chat:inflight:{conversationId}`, `SET NX EX`) whose **value is the `turnId`**, enforcing the _one in-flight Turn per Conversation_ invariant. Acquired by **`beginTurn`** as the Turn's first step (before the stale-Stream discard, user Message, credits, or enqueue — a duplicate tab returns `alreadyInflight` having touched nothing); released by **`settleTurn`** on a worker terminal (run in the worker's `finally`) or by `reconcileTurn` on orphan recovery, and only ever by the Turn that still owns it — a guarantee of the _interface_, not of convention: the release is `@acme/redis`'s **compare-and-delete** (one server-side `EVAL`), so the lapsed-TTL re-acquire that a `GET`-then-`DEL` pair would clobber has no window to land in. The worker does **not** renew it — there is no heartbeat. Crash recovery is the TTL plus `chat.reconcileTurn`: a worker that dies mid-Turn leaves the lock to self-expire after `INFLIGHT_LOCK_TTL` (600s), after which the next `beginTurn` re-acquires; before that, a client whose reader closes with no terminal calls `reconcileTurn` to refund + tear down. The TTL is kept comfortably longer than the longest expected generation so a live worker's lock never lapses under it. Distinct from BullMQ `jobId` dedup (`conversationId:turnId`), which only collapses duplicate _enqueues_.
_Avoid_: "mutex", "semaphore", conflating it with the BullMQ jobId

**Turn lifecycle**:
The one module (`chat-turn-lifecycle.ts`) that owns a durable **Turn**'s Redis control plane as terminal-typed **transitions**, not a bag of Redis verbs. The transitions: **`beginTurn`** (acquire the **In-flight lock**, discard a stale **Stream**, run the ordered begin steps, and unwind the lock on any failure — reports `accepted` vs `alreadyInflight`); **`settleTurn(kind)`** where `kind` is the worker terminal (`done` | `cancelled` | `error`) that shortens the **Stream** to its post-terminal window and releases the lock; **`abortTurn`** (publish the stop signal); and **`reconcileTurn`** (idempotent refund + hard-delete teardown of an orphaned Turn). Liveness is read once here — **`readInflightTurn`** ("which Turn is live", used by the router — including as the `keepGoing` lock probe it injects into the **Stream** reader, so the reader no longer reads the lock itself) and **`isTurnAborted`** ("has this Turn been told to stop", used by the **Generation worker**) — so no call site reads the lock/abort keys directly. The begin-step ordering and the failure-path lock unwind live inside `beginTurn`, not inlined in `chat.send`; the **Credit** consume stays inline in `chat.send` (passed to `beginTurn` as a closure). The transitions are tested directly against a real Redis (`tests/backend/integration/service/chat-turn-lifecycle.test.ts`) — the failure-path unwind, the `settleTurn` (shorten) vs `reconcileTurn` (hard-delete) Stream distinction, and the refund race — rather than only through the procedures that call them.
_Avoid_: "teardown verb", naming `finalizeTurn`/`cleanupTurn`/`discardStaleStream` (collapsed into the transitions above), calling a transition a "Redis verb".

**Client Turn reducer**:
The client-side counterpart to the **Turn lifecycle** — a pure state machine (`chat-turn-reducer.ts`, beside `use-chat.ts`) that owns a Turn's lifecycle _from this client's point of view_. It reduces `{ phase, ownedTurnId, resumeConsumed }` over reader/mutation **events** (`send`, `sendResult`, `streamDelta`, `streamTerminal`, `readerStarted`, `readerClosed`, `historyReconciled`, …) and returns `{ nextState, intents }`. Phases stay `idle | sending | streaming | settling`. It imports **no** React-Query API and reads no ref: because it is the single source of the current phase, a delta/close/adopt arriving after the Turn settled is a guarded no-op decided _in the reducer_, subsuming the old per-callback `phaseRef` re-check. `useChat` holds the state (a mirror ref for sync reads inside async callbacks) and applies the returned **Cache intents**; the wedged-Turn bubble stays a pure _view_ derivation (`deriveMessages`) — no state, no cache write.
_Avoid_: "phaseRef" (removed), putting phase decisions in the hook callbacks, calling the reducer a "hook".

**Cache intent**:
A declarative record the **Client Turn reducer** returns naming a cache effect for `useChat` to apply — the reducer decides _what_, the hook owns the _mechanism_ (`setQueryData` / `invalidateQueries` / `cancelQueries` against `chat.get`, `chat.list`, `chat.inflightTurn`, plus the credit-refresh and `reconcileTurn` side-effects). Kinds include `optimisticUserTurn`, `appendDelta`, `settleAssistant`, `errorAssistant`, `spliceHistoryPrefix`, `adoptHistory`, `upsertConversation`, and the two authoritative-history reads (`readHistoryForPrefix` / `readHistoryForReconcile`) whose results the hook re-dispatches as events. Keeps React-Query mechanism in the hook and lifecycle decisions in the pure reducer.
_Avoid_: "action"/"command" (it is not dispatched back into the reducer), having the reducer touch a QueryClient directly.

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
- A **Turn** is triggered by `chat.send({ query, conversationId, turnId })` (a mutation): the ownership builder asserts ownership, then `chat.send` delegates the begin sequence to the Turn lifecycle's **`beginTurn`** — take the **In-flight lock** (`SET NX`, valued by `turnId`) first, discard a stale Stream, ensure the Conversation, persist the **user** Message, run `chat.send`'s credit gate + consume (passed in as a closure so it stays inline), and enqueue a **Generation worker** job — then returns. `beginTurn` owns the ordering and unwinds the lock on any failure; `chat.send` keeps only the credit consume inline. It never streams. Two-tab races return a discriminated result: `{ accepted, turnId }` for the winner, `{ alreadyInflight }` for the loser (which rolls back, attaches, and restores its draft).
- A **Stream** is _read_ (not initiated) by `chat.stream({ conversationId, lastEventId? })` — an always-on, side-effect-free subscription that tails the Redis **Stream** and re-emits deltas + terminal via `tracked()`. The **assistant** Message is generated and persisted by the worker, not by any procedure.
- `chat.stop({ conversationId })` cancels an in-flight Turn (control-plane: publish → worker abort); `chat.reconcileTurn({ conversationId, turnId })` refunds + cleans up an orphaned Turn (idempotent via `chat:refunded:{turnId}`), keeping `chat.stream` pure.
- `chat.get(conversationId)` returns all Messages in a Conversation in order
- `chat.delete(conversationId)` removes the Conversation and all its Messages
- `chat.list()` returns the caller's Conversations as flat summaries (`sessionId`, `title`, `updatedAt`, `folderId`) ordered `updatedAt DESC` — the Conversation History list. The server sorts; the client derives Date Buckets.
- `chat.setFolder(conversationId, folderId)` moves a Conversation into a Folder, or out of one with `folderId: null`
- `chat.folders.list / create / delete` manage Folder definitions, scoped to the caller
- Admin procedures (`adminGet`, `adminList`) can access any user's Conversations

## Decisions

See [`docs/adr/`](docs/adr/).
