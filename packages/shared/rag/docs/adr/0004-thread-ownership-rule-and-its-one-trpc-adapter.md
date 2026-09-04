# The thread-ownership rule is transport-free, and has exactly one tRPC adapter

**Status:** accepted

Mastra Memory owns Conversation threads and stamps each one's `resourceId` with
the owning `userId` ([ADR 0001](0001-mastra-rag-and-memory.md)). Any feature that
annotates a Mastra-owned thread therefore has to answer the same question before
it writes: does this thread belong to this caller? Today that is `@acme/chat`
(its ownership procedure builders) and `@acme/feedback` (`submit`), and the
answer has to be identical in both — a thread `feedback` will accept a rating on
is exactly a thread `chat` would let you read.

The question is _whose_ it is. `@acme/rag` owns the `resourceId` vocabulary, so
the rule belongs here; but the features that ask it speak tRPC, and `@acme/rag`
is a `shared` package that is not supposed to know about transports.

## Decision

The rule and its transport mapping are **two modules**, and the split is the
decision.

- **`ownership.ts` — the rule, transport-free.** `assertThreadOwned(threadId,
userId)` returns three outcomes and nothing else: the thread when owned,
  `null` when it does not exist yet, and a thrown `ThreadOwnershipError` when it
  belongs to someone else. It imports no transport and names no HTTP status.
- **`ownership-trpc.ts` — the one tRPC adapter.** `mapOwnershipError` turns a
  `ThreadOwnershipError` into `FORBIDDEN` and rethrows everything else
  unchanged; `assertOwnedThreadForTRPC` is the convenience wrapper that runs the
  rule and maps its one expected failure. This module is the **only** place in
  the repo that decides how thread ownership maps onto tRPC.

`@acme/rag` depending on `@acme/trpc`'s `TRPCError` here is deliberate and
boundary-legal: `shared` may depend on `platform`. The exception is _named_ and
confined to one file — `ownership.ts` stays clean, so the rule remains reusable
by a non-tRPC caller.

**Absence is not decided here.** `assertOwnedThreadForTRPC` returns `null` for a
thread that does not exist rather than mapping it to `NOT_FOUND`, because the
callers genuinely differ: chat's `stream`/`create` tolerate a not-yet-stamped
thread, while `get`/`delete` and feedback's `submit` treat absence as
`NOT_FOUND`. Only the _foreign-owner_ outcome has one right answer, so only that
one is centralised.

`OwnedThread` is `@acme/rag`'s own interface, not a Mastra type. `toOwnedThread`
narrows Mastra's thread onto it, so `StorageThreadType` never crosses the seam.

## Why

- **A new ownership outcome gets handled once.** Adding a variant (a shared
  thread, a soft-deleted one) means editing one adapter. With the mapping
  inlined per feature it means finding every feature that annotates a thread and
  hoping none was missed — and the two that exist already sit in different
  packages.
- **Two features must not be able to disagree.** Two hand-rolled mappings
  typecheck and can still differ: one returns `FORBIDDEN`, the other leaks a
  `NOT_FOUND` that tells an attacker the thread exists. Centralising the mapping
  makes the divergence unrepresentable rather than merely discouraged.
- **The rule outlives the transport.** Keeping `ownership.ts` transport-free is
  what lets a worker, a server function or a future non-tRPC caller ask the same
  question. The adapter is additive; the rule is the asset.
- **Mastra stays contained.** `OwnedThread` exposes only the fields callers
  consume, so replacing the memory store means satisfying one small interface —
  the containment ADR 0001 relies on.

The cost: `@acme/rag` ships a transport-shaped export, so the "no framework
specifics in shared" rule has a documented exception rather than being absolute.
That is the trade — one named exception in one file, against the same mapping
re-expressed in every consuming feature.

## Considered and rejected

- **Each feature maps `ThreadOwnershipError` itself.** Rejected — this is the
  state the split replaced. It is the divergence risk above, and it scales with
  every new feature that touches a thread.
- **Put the mapping in `@acme/trpc`.** Rejected — `platform` would then depend
  on rag's `ThreadOwnershipError`, inverting the layer direction, and the
  substrate would acquire a domain rule that only two features use.
- **Fold the mapping into `ownership.ts` and drop the second module.** Rejected
  — it makes the rule itself tRPC-only, so a worker or a non-tRPC caller cannot
  use it without catching a `TRPCError` it has no business seeing.
- **Decide absence (`null` → `NOT_FOUND`) in the adapter too.** Rejected — the
  callers legitimately disagree, so a single answer would force chat's
  `stream`/`create` to work around it for the not-yet-stamped-thread case.
- **A tRPC middleware in `@acme/rag`.** Rejected — a middleware has to bind to a
  concrete tRPC context, which is the feature's to declare, so it cannot live in
  a shared package. Chat builds its own ownership procedure builders on top of
  this adapter for exactly that reason.
