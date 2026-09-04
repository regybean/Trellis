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
Factory that returns a `Worker` instance wired to the same connection. `processor` is the job handler (built in `@acme/chat` by the `createChatGenerationProcessor(entitlements)` factory, which closes over the app-injected `EntitlementsProvider`). Callers: app-owned `worker.ts` entry points, which import the provider from their app's composition root (`src/server/deps.ts`) — the same value the route handler reads, because it is built exactly once.

## Relationships

- `@acme/queue` is imported by `@acme/chat` (for `createQueue`) and by each app's `worker.ts` (for `createWorker`).
- The connection BullMQ uses is a separate ioredis instance from `@acme/redis`'s `redis` / `redisPub` / `redisSub` — BullMQ creates and manages it internally via plain connection options derived from `REDIS_URL`.
- Queue names live here (not in `@acme/chat`) so both producer and consumer reference the same constant without a circular dependency.

## Decisions

See [`docs/adr/`](../../../docs/adr/).
