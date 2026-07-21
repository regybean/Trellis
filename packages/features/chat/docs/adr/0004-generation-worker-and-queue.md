# 0004 — Generation Worker and Queue

**Status:** Accepted  
**Supersedes:** —  
**Related:** ADR 0002 (Mastra Memory), ADR 0003 (Ownership middleware), system-wide ADR 0008 (ioredis)

## Context

The old `chat.stream` procedure coupled LLM generation to the HTTP connection: if the SSE stream disconnected, generation stopped and the partial response was lost. The user had to restart from scratch.

## Decision

LLM generation is decoupled from the HTTP connection by running it in a durable **Generation Worker** — a long-lived Node process draining a BullMQ queue. The worker publishes token deltas to a Redis Stream keyed by `conversationId`. A separate `chat.stream` subscription (T5) tails that stream, so any reconnecting client resumes from its last received entry.

### Worker is a turbo dev-graph task, not a compose service

Each app has a thin `apps/<app>/worker.ts` entry point (T6) that calls
`createWorker` from `@acme/queue` with `chatGenerationProcessor` from
`@acme/chat/server`. In development each app's `turbo.json` `dev` task lists a
`dev:worker` sibling under `with`, so `pnpm dev` launches the worker alongside
the app's Next.js / Vite process as a second persistent task. The `dev:worker`
script runs `tsx watch --conditions=react-server worker.ts` — `--conditions`
resolves `@acme/chat/server`'s `import 'server-only'` to its empty stub instead
of the guard that throws outside an RSC bundle; `watch` restarts the worker on
source changes.

Rationale for NOT using a compose service:

- Each app targets its own Redis namespace (`NEXT_PUBLIC_WEBAPP`), its own BullMQ
  queue prefix (see below), and its own Postgres schema — a shared compose
  service would need per-app env injection, which is fragile. The worker
  inherits the app's env via `pnpm with-env`, so isolation maps naturally to one
  process per app.
- The worker has no HTTP listener; it is purely a background processor.
- No startup ordering is needed: the queue decouples producer from consumer, so
  a job `chat.send` enqueues before the worker is up is simply drained once it
  comes online. `with` (concurrent siblings) is the right primitive — not a
  `dependsOn` edge, which turbo would anyway reject against a persistent task.

### Per-app BullMQ queue prefix

All apps share one Redis instance, so the `generation` queue name alone is not
isolation: without a per-app prefix, every app's worker would drain the same
`bull:generation` list and could process a foreign app's job — then persist
under the wrong Redis namespace and Postgres schema. `@acme/queue`'s
`createQueue` / `createWorker` therefore set `prefix: NEXT_PUBLIC_WEBAPP`, so app
`nextjs` owns `nextjs:generation:*`. Producer (`chat.send`) and consumer (app
`worker.ts`) both run under the app's env and resolve the same prefix without
coordination. This mirrors the `nsKey` Redis-key partitioning and the per-app
Postgres schema.

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
- The worker process must be running for chat to work; in development `pnpm dev` spawns it automatically via the `with` sibling task. The "not a compose service" rationale is documented inline in each `apps/<app>/worker.ts` header and here.
