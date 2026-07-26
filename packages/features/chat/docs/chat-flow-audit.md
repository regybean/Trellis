# Chat flow

A description of what the chat feature **actually** does at runtime — the
control plane, the data plane, the frontend Turn state machine, and every
page-refresh variation. Reflects the Turn-lifecycle simplification of #115.

Diagrams are kept as standalone `.mermaid` files (repo convention, cf.
`docs/task-graph-topo.mermaid`) so they render in the same tooling:

| Diagram                                       | File                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| System overview (control plane vs data plane) | [`chat-flow-overview.mermaid`](chat-flow-overview.mermaid)           |
| Frontend Turn state machine (`useChat`)       | [`chat-flow-turn-state.mermaid`](chat-flow-turn-state.mermaid)       |
| First-message happy path (round trip)         | [`chat-flow-first-message.mermaid`](chat-flow-first-message.mermaid) |
| Refresh points & resume behaviour             | [`chat-flow-refresh.mermaid`](chat-flow-refresh.mermaid)             |

Source of truth for the code: `hooks/use-chat.ts`, `api/routers/chat.ts`,
`api/services/chat-*.ts`, `components/conversation-view.tsx`. Domain language:
[`../CONTEXT.md`](../CONTEXT.md). Decisions: [`adr/`](adr/).

---

## 1. The two planes

Generation is fully decoupled from the client connection (ADR 0004). The system
splits into a **control plane** (request/response tRPC mutations) and a **data
plane** (a durable Redis Stream tailed by a pure subscription). See
[`chat-flow-overview.mermaid`](chat-flow-overview.mermaid).

| Concern                | Where it lives                                    | Notes                                                                                        |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Initiate a Turn        | `chat.send` mutation                              | lock → discard stale stream → ensure convo → persist **user** msg → consume credit → enqueue |
| Produce tokens         | Generation **worker** (`chatGenerationProcessor`) | `xAdd` deltas, persist **assistant** msg on terminal, `xAdd` terminal, title on first turn   |
| Read tokens            | `chat.stream` subscription (`tailChatStream`)     | pure `XRANGE` poll, re-emits via `tracked(id, event)`, closes on terminal / drain / abort    |
| Cancel                 | `chat.stop`                                       | publishes abort key; worker observes, persists partial, emits `cancelled`                    |
| Orphan cleanup         | `chat.reconcileTurn`                              | idempotent refund + teardown                                                                 |
| Resume probe           | `chat.inflightTurn`                               | returns lock's `turnId` or null                                                              |
| History / render state | `chat.get` (persisted, ADR 0025)                  | **single source of truth** — the optimistic user msg + streamed deltas are written here too  |
| Sidebar                | `chat.list` (persisted)                           | optimistic "New chat"                                                                        |

The In-flight lock (`chat:inflight:{cid}` = `turnId`) is **not** renewed by the
worker — there is no heartbeat. Crash recovery is the lock's TTL
(`INFLIGHT_LOCK_TTL` = 600s) plus `chat.reconcileTurn`; see the In-flight lock
entry in [`../CONTEXT.md`](../CONTEXT.md).

## 2. Frontend state — one source of truth, one phase value

`useChat` models one Turn with a **single `phase`** and writes every rendered
Message into the **`chat.get` React Query cache**. See
[`chat-flow-turn-state.mermaid`](chat-flow-turn-state.mermaid).

- **`messages` derives from `chat.get`.** `send` seeds the optimistic user
  Message + a loading assistant bubble into that cache (`setQueryData`), and the
  Stream appends deltas into the same entry. There is no separate sticky
  `localMessages`, so no splice/reconcile dance between two representations.
  `chat.get`'s output is `uiMessageSchema[]`, so an in-flight entry may carry
  `loading`/`error` and lack an `id` — the server only ever returns settled rows.
- **`phase: 'idle' | 'sending' | 'streaming' | 'settling'`** is the one
  render-visible Turn value. `isSending` (`phase !== 'idle'`), the subscription
  `enabled` flag (`phase === 'streaming' || shouldResume`), and the settle guard
  all derive from it. `phaseRef` mirrors it for synchronous reads inside the
  async subscription/mutation callbacks.
- **Refs** remain only where a synchronous read inside an async callback is
  unavoidable: `ownedTurnIdRef` (the `turnId` we minted and own, for reconcile).
  There is no separate "terminal seen" ref — every terminal path calls
  `finishTurn`, moving `phase` off `streaming`, so the reader-close handler's
  `phase === 'streaming'` guard already discriminates a settled Turn from an
  orphaned close. Resume bookkeeping (`resumeConsumed`) is plain state — it is
  read during render.
- **Settle triggers on the terminal event** (`done`/`cancelled`/`error`), which
  folds the finished Turn into the cache and returns `phase` to `idle`. A reader
  **close without a terminal** (a clean `idle` drain or an unrecoverable
  `onError`) is the **orphan / missed-terminal** trigger, not the settle trigger.

## 3. First-message happy path

See [`chat-flow-first-message.mermaid`](chat-flow-first-message.mermaid). The URL
is stamped **synchronously** inside `send()` (via `onSend`), so the
Conversation is resumable almost the instant the user hits send.

## 4. Refresh points & what happens on reload

Behaviour on refresh depends on **(a)** whether the URL was stamped and **(b)**
what `chat.inflightTurn` + `chat.get` return at mount. See
[`chat-flow-refresh.mermaid`](chat-flow-refresh.mermaid).

Chat's `QueryClient` defaults to **`refetchOnMount: 'always'`** (query-client.ts)
— every persisted read (`chat.get`, `chat.list`) paints its restored snapshot
instantly (ADR 0025) but revalidates against server truth on every mount. This
is load-bearing: the persister only stores _successful fetches_, but these caches
are also written optimistically via `setQueryData` (the streamed Messages; the
"New chat" sidebar row), and those writes never reach the persisted snapshot. So
the restored snapshot lags reality — a first-Turn Conversation persists the empty
greeting load (`[]`) with a _recent_ `dataUpdatedAt`; the sidebar persists the
list _before_ the new thread. Without the mount refetch that stale-but-"fresh"
snapshot is served under `staleTime`, so on refresh the message pane stays blank
whenever the resume path doesn't fire (Turn already settled, or the lock released
as we reloaded — the resume-adopt was the _only_ thing repainting `base`) **and**
the just-created Conversation is missing from the sidebar. Two consequences:

- **`isHistoryLoading` keys on `isFetching` while `base` is empty**, not just the
  no-data `isLoading`. So the mount revalidation of a stale/empty snapshot shows
  the skeleton, not a flash of the empty greeting pane, right as a Turn settles
  and the resume path stops repainting.
- **Wedged detection waits for the fetch to settle** (`!historyQuery.isFetching`)
  — a refresh landing mid-finalize (lock released, assistant not yet persisted)
  reads `[user]` + `inflightTurn: null`, which would otherwise flash a spurious
  error bubble before the refetch delivers the assistant Message.

| When you refresh                            | URL stamped? | `inflightTurn`       | `chat.get` (after mount refetch) | Result                                                                                                                                                              |
| ------------------------------------------- | ------------ | -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before 1st send                             | No (bare)    | —                    | —                                | New id, empty pane. Optimistic msg lost.                                                                                                                            |
| Just after 1st send, mid-stream             | Yes          | `turnId`             | `[user]` (refetched)             | **Resume-adopt**: `onStarted` appends a loading bubble into the cache and `refreshHistoryPrefix` splices the authoritative `[user]` in front, then tails the stream |
| 2nd+ message mid-stream                     | Yes          | `turnId`             | `[…prior turns]`                 | Same resume-adopt; mount refetch keeps the prefix current                                                                                                           |
| After `done`, within stream TTL (60s)       | Yes          | null (lock released) | `[user, assistant]` (refetched)  | History only, no subscription — the mount refetch shows the settled Turn instead of a stale empty snapshot                                                          |
| After worker crash, lock still held (<600s) | Yes          | `turnId`             | `[user]`                         | Reader opens, polls until lock TTL; on close → orphan → refund                                                                                                      |
| After lock TTL lapsed                       | Yes          | null                 | `[user]` only                    | **Wedged-Turn detection**: `chat.get` ends on a user Message with no reply and the probe is null, so `useChat` renders an error bubble instead of stalling silently |

---

## 5. How the fragile bits were resolved (#115)

The prior audit flagged six issues; this is how the current code addresses them.

1. **Fictional worker heartbeat — removed.** The worker never renewed
   `chatInflightKey`; the claim is deleted from `CONTEXT.md` and
   `chat-turn-lifecycle.ts`. Crash recovery is documented as the lock TTL +
   `reconcileTurn`, with the TTL kept longer than the longest expected
   generation so a live worker's lock never lapses under it.
2. **Dead `useGetMessages` — deleted.** (It was also a rules-of-hooks footgun
   that suppressed the React Compiler / `react-hooks/refs` analysis of the hook.)
3. **Dual source of truth — collapsed.** The optimistic user Message and the
   streamed deltas go into the `chat.get` cache; `messages` derives from it.
   `resumeSeed` / `adoptFreshHistory` and `reconcileOrAdopt`'s "drop
   localMessages" branch are gone. Trade-off: the in-flight assistant partial is
   briefly held (and, via the persister, briefly persisted) in `chat.get` — an
   accepted amendment to ADR 0025.
4. **Six-variable Turn model — one `phase`.** See §2.
5. **Settle on `idle` — now settles on the terminal.** The `terminalReceived`
   bridge and the "missed terminal" ambiguity are gone: a close without a
   terminal is the orphan trigger.
6. **Wedged-Turn gap — closed.** See the last row of §4.

## 6. Watch-outs for future edits

- **`chat.get` is written, not just read.** Any change that invalidates or
  refetches `chat.get` mid-Turn can clobber the streaming bubble. The orphan /
  resume reads use the **vanilla tRPC client** (`useTRPCClient`) precisely so a
  fetch does not write the cache; `send` `cancelQueries` first for the same
  reason. `finishTurn` deliberately does **not** invalidate `chat.get`. The one
  refetch that _does_ run mid-Turn is the `refetchOnMount: 'always'` fetch on a
  resume-after-refresh — `onStarted` `cancelQueries` cancels it before deltas
  flow, and `refreshHistoryPrefix` supplies the authoritative prefix via the
  vanilla client, so it never clobbers the bubble.
- **Title-detection string coupling (minor).** `createConversation` writes title
  `'New conversation'`; the worker's `isFirstTurn` checks for exactly that; the
  client optimistic list writes `'New chat'`. Two magic strings that must not
  drift.
