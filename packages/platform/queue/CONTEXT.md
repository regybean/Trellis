# Platform Queue (`@acme/queue`)

The BullMQ home: thin factories for creating Queues and Workers, plus the canonical queue-name constants. It owns the BullMQ dependency and manages its own ioredis connection internally — separate from `@acme/redis`'s clients.

## Language

**Queue name**:
A constant from `QUEUE_NAMES` (e.g. `QUEUE_NAMES.GENERATION`). The single source of truth for the string passed to both `createQueue` and `createWorker` — a BullMQ queue is identified by name, so mismatched strings between producer and consumer silently routes to the wrong queue.
_Avoid_: hard-coded string literals for queue names

**Generation queue** (`QUEUE_NAMES.GENERATION`):
The queue that carries `GenerationJob` payloads from `chat.send` to the Generation worker. One job per Turn; `jobId = conversationId:turnId` enforces BullMQ-level dedup.
_Avoid_: "the chat queue", "the worker queue"

**`createQueue(name, options?)`**:
Factory that returns a `Queue` instance wired to the shared internal connection. Adds an error listener that routes to the logger. Callers: enqueue-side code (`enqueueGenerationTurn` in `@acme/chat`).

**`createWorker(name, processor, options?)`**:
Factory that returns a `Worker` instance wired to the same connection. `processor` is the job handler (lives in `@acme/chat` as `chatGenerationProcessor`). Callers: app-owned `worker.ts` entry points.

## Relationships

- `@acme/queue` is imported by `@acme/chat` (for `createQueue`) and by each app's `worker.ts` (for `createWorker`).
- The connection BullMQ uses is a separate ioredis instance from `@acme/redis`'s `redis` / `redisPub` / `redisSub` — BullMQ creates and manages it internally via plain connection options derived from `REDIS_URL`.
- Queue names live here (not in `@acme/chat`) so both producer and consumer reference the same constant without a circular dependency.

## Design decisions

**Plain connection options, not an ioredis instance**: BullMQ v5 bundles its own ioredis internally. Passing an externally-created ioredis instance causes structural type conflicts between the two ioredis copies. Passing plain options (`{ host, port, password?, db?, maxRetriesPerRequest: null }`) lets BullMQ create and own its connections, which is also the approach the BullMQ docs recommend.

**`maxRetriesPerRequest: null`**: Required for BullMQ Workers. Without it, ioredis times out blocking commands (e.g. `BRPOPLPUSH`) used by BullMQ's job-draining loop. Queues don't technically need it but we apply it uniformly.

**Queue names in `@acme/queue`, not `@acme/chat`**: The producer (`@acme/chat`) and consumer (app `worker.ts`) both need the queue name. Centralising it here avoids either: (a) the consumer importing `@acme/chat` (wrong direction — feature → platform), or (b) duplicating string literals that can silently diverge.
