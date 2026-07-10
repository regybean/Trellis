# 0004 — Generation Worker and Queue

**Status:** Accepted  
**Supersedes:** —  
**Related:** ADR 0002 (Mastra Memory), ADR 0003 (Ownership middleware), system-wide ADR 0008 (ioredis)

## Context

The old `chat.stream` procedure coupled LLM generation to the HTTP connection: if the SSE stream disconnected, generation stopped and the partial response was lost. The user had to restart from scratch.

## Decision

LLM generation is decoupled from the HTTP connection by running it in a durable **Generation Worker** — a long-lived Node process draining a BullMQ queue. The worker publishes token deltas to a Redis Stream keyed by `conversationId`. A separate `chat.stream` subscription (T5) tails that stream, so any reconnecting client resumes from its last received entry.

### Worker is a turbo dev-graph task, not a compose service

Each app has a thin `apps/*/worker.ts` entry point that connects to BullMQ and calls `chatGenerationProcessor` from `@acme/chat`. In development this is wired as a `dev` dependency in `turbo.json` so it spins up alongside the app's Next.js / Nitro process.

Rationale for NOT using a compose service:

- Each app targets its own Redis namespace (`NEXT_PUBLIC_WEBAPP`) and Postgres schema — a shared compose service would need per-app env injection, which is fragile.
- The worker has no HTTP listener; it is purely a background processor.
- Turbo's task graph gives correct startup ordering (app waits for worker to be ready).

### Request-less trust model

The worker carries no HTTP request and performs no ownership assertion. Ownership was asserted by `chat.send` before the job was enqueued. `userId` in the job payload stamps `resourceId` for Mastra. Redis and BullMQ are inside the app's security perimeter; `enqueueGenerationTurn` is the sole authorised enqueuer (structural enforcement — no other code path can add to the generation queue), making the trust perimeter structural rather than checked at runtime.

This is the only carve-out from the ownership-as-middleware rule in ADR 0003: the worker receives a trusted, pre-validated payload from a queue that only `chat.send` can write to.

### Key builders

All chat lifecycle Redis keys are built via `nsKey` (see `src/api/chat-keys.ts`) so they carry the per-app namespace prefix:

| Key                              | Value                | Purpose                                  |
| -------------------------------- | -------------------- | ---------------------------------------- |
| `chat:stream:{conversationId}`   | Redis Stream entries | Token deltas + terminal                  |
| `chat:inflight:{conversationId}` | `turnId`             | Lock — at most one Turn per Conversation |
| `chat:abort:{conversationId}`    | `turnId`             | Abort signal from `chat.stop`            |
| `chat:refunded:{turnId}`         | `'1'`                | Idempotency guard for credit refunds     |

### Stream entry shape

Delta entries: `{ chunk: string }`. Terminals are one of:

- `{ type: 'done', messageId?: string }` — full response persisted
- `{ type: 'cancelled', messageId?: string }` — non-empty partial persisted
- `{ type: 'error' }` — nothing persisted; credits refunded

### Memory auto-persist disabled

`chatAgent.stream()` is called with `options: { readOnly: true }` so Mastra recalls conversation context but does NOT auto-save messages. The processor controls persistence explicitly:

- User message: persisted by `chat.send` before enqueueing (durable before first token).
- Assistant message: persisted by the worker on clean completion (`done`) or non-empty abort (`cancelled`). Not persisted on error so the errored partial cannot poison recall.

## Consequences

- Generation survives client disconnects; resumable via `lastEventId`.
- One BullMQ queue (`generation`) and one ioredis connection owned by `@acme/queue` — separate from the `@acme/redis` facade.
- `@acme/chat` gains `@acme/queue` and `@acme/subscriptions` as dependencies.
- The worker process must be running for chat to work in development and production; it is documented in each app's README.
