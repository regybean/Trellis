# One progress stream per user, carrying no job-level terminal

**Status:** accepted — ticket #188, moved onto the shared primitive in #196

## Context

Live per-Upload stage transitions have to reach a browser that may reload,
navigate away, or be one of several tabs. The obvious grain is one stream per
Job — chat does exactly that per Turn, and a per-Job stream can announce its own
end and then be closed.

Ingest cannot use that grain honestly. An operator can start a second batch while
the first is still indexing, and the reader is mounted on the documents page, not
on a Job. A per-Job stream would mean the page subscribing to an open-ended set
of streams and discovering new ones as they appear.

The transport underneath — the `xRange` poll loop with idle backoff, the
abort-aware delay, the atomic append-with-TTL — is shared with chat and
notifications and belongs to `@acme/redis`
([@acme/redis ADR 0001](../../../../platform/redis/docs/adr/0001-durable-redis-stream-primitive.md)).
What is decided here is only ingest's own half.

## Decision

**One Redis Stream per user, across every Job.**
`ingestProgressKey(userId) = nsKey('ingest','progress',userId)`. The page
subscribes once and sees every Job the user has running, including ones started
in another tab. `jobId` rides on every event, so a consumer that cares about one
Job filters rather than resubscribes.

**The wire shape is a zod discriminated union on `stage`.**
`queued | parsing | embedding | done | failed` over the base identity
`{ jobId, uploadId, filename }`, with `error` required on `failed` and
unrepresentable elsewhere. `stage` is always present, so a producer typo
(`'parsng'`) throws at parse instead of being read as a silently dropped event.
`uploading` deliberately **never appears on the wire** — it is the browser→S3
PUT, which the server does not observe.

**The writer is the sole appender and stamps a rolling TTL on every append.**
`createIngestProgressWriter(userId, jobId)` closes over `jobId`, so the processor
codes against `queued(uploadId, filename)` / `stage(…, 'parsing' | 'embedding')`
/ `done` / `failed` and cannot get the identity wrong. Every append refreshes the
retention TTL atomically (`xAddWithTtl`), so an abandoned stream self-expires and
**nothing ever deletes the key** — there is no cleanup path to get wrong, and no
window where a crash between append and expire leaves the stream immortal.

**No job-level terminal rides this stream.** Nothing appends "the Job is done",
and the reader has no stop predicate — it closes only on abort. The stream alone
cannot distinguish "every Upload finished" from "the worker died holding the
batch", so claiming completion here would mean claiming it from absence of
evidence. Job completion is owned solely by the notification stream
(`ingest.job-complete` via `@acme/notifications`), fire-and-forget.

**Retention and poll bounds are authored config, not constants.**
`INGEST_PROGRESS_TTL_SECONDS` (1h), `INGEST_PROGRESS_POLL_MIN_MS` and
`INGEST_PROGRESS_POLL_MAX_MS` are profile-authored in `env.ts` and
env-overridable per deploy
([@acme/env ADR 0001](../../../../platform/env/docs/adr/0001-one-env-factory-per-slice.md)).
The retention window is a product decision — how far back a reload may rejoin —
so a deploy gets to move it.

## Consequences

- **Positive.** One subscription per page regardless of how many Jobs are in
  flight, and a second tab sees the first tab's progress for free.
- **Positive.** The retained stream doubles as the durable store that makes a
  refresh survivable, with no Postgres table
  ([ADR 0001](0001-ingest-progress-survives-refresh.md)).
- **The stream is a firehose, and readers must tolerate it.** Every Job of every
  batch shares one key, so a reader is handed events for Uploads it never
  authored. That is why the client seeds unknown `uploadId`s rather than dropping
  them, and why the read path is a snapshot fold rather than a head replay —
  replaying an hour of finished Jobs is the cost of this grain.
- **Retention is the only durability boundary.** Past the TTL a reload rejoins
  nothing, and a `lastId` older than the window resumes from a stream that has
  expired past it.
- **A user's streams are unbounded in count, not size.** One key per user with no
  reaper means a deployment accumulates one expiring key per active operator.
  Acceptable because ingest is admin-only — there are few operators.
