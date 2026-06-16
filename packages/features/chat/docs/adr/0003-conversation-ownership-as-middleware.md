# Conversation ownership is a tRPC middleware seam, not a per-procedure check

Thread ownership was enforced by every procedure calling a shared `getOwnedThread`
helper — a security invariant that depended on each procedure _remembering_ to call
it. We moved the rule into two feature-local procedure builders
(`ownedConversationProcedure`, `existingConversationProcedure`) that load-and-verify
the Conversation before the procedure body runs and inject the verified thread as
`ctx.conversation`. A procedure that touches a Conversation now cannot be written
without going through a builder, so an unguarded procedure is structurally
impossible rather than merely discouraged. The check itself, and all
thread↔Conversation transforms, live behind one chat-memory adapter; the router no
longer imports `memory`.

## Status

accepted (refines [0002-mastra-memory-owns-conversation-persistence](0002-mastra-memory-owns-conversation-persistence.md), whose "ownership is enforced in the procedure" consequence this replaces)

## Why

The old shape scattered one security rule across four procedures with no single seam
owning it: nothing stopped a fifth procedure from forgetting the check, and ownership
coverage was implicit in per-procedure tests. Seating the rule on a procedure builder
makes the invariant load-bearing at the type/pipeline level — the builder is the only
way to obtain an owned `ctx.conversation` — and lets one ownership suite replace the
scattered per-procedure cases. Folding the transforms into the same adapter (the #3
deepening) removes the router's direct `memory` access, which is what makes "no
unguarded path to a thread" actually true rather than just conventional.

## Considered and rejected

- **Keep a single `getOwnedThread` helper, just call it everywhere.** The status quo.
  Leaves the rule scattered and forgettable; no structural guarantee. Rejected — this
  is the problem.
- **One middleware that always injects a nullable `ctx.conversation`, leaving
  `NOT_FOUND` to each procedure body.** Simpler (one builder), but `get`/`delete`
  could still forget the existence check. The two-builder split makes _both_ the
  ownership and existence invariants structural, so `get`/`delete` receive a
  guaranteed non-null owned Conversation. Rejected in favour of two builders.
- **A platform-level generic resource-ownership middleware in `@acme/trpc`.** Platform
  cannot import `@acme/rag` (an upward boundary violation), and no second feature
  needs this yet. Kept the middleware feature-local. Revisit if resource-ownership
  recurs.
- **An owned-thread data-access adapter only (no middleware).** Guards data access but
  still lets a procedure be written that forgets to call it. The middleware is what
  makes the guarantee structural; the adapter is what makes it total. We did both.

## Consequences

- Ownership is checked _before_ rate limiting on `stream` (`ownedConversationProcedure.use(rateLimit())`),
  so a `FORBIDDEN`/`NOT_FOUND` request consumes no credits.
- `stream` and `create` run on `ownedConversationProcedure` and tolerate an absent
  thread (`ctx.conversation` is null): Mastra Memory stamps `resourceId = userId` on
  first write, so a caller can only ever create a Conversation they own.
- `create`'s only residual body logic is the idempotent create-or-retrieve
  (`ctx.conversation ?? createConversation(...)`).
- Admin read paths (`adminGet`, `adminList`) deliberately bypass ownership through the
  named adapter accessors `getConversationUnchecked` / `listConversations`, so the
  unguarded access is visible rather than a raw `memory` call in the router.
- The `ChatService` pass-through is gone; the router calls `chatAgent.stream`
  directly. `chat-agent.ts` stays (it is also the agent registered with Mastra for
  Studio).
- The wire contract (`StreamChatEvent`) is unchanged.
