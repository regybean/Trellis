# Ingest progress survives a refresh: snapshot → resume-from-lastId

**Status:** accepted (ticket #194, follow-up to #189 / epic #171).

## Context

Ingest kept live per-Upload progress in a **mount-owned `useReducer`** fed by a
**tail-from-now** Redis-stream reader, with **no snapshot on mount** and a reducer
that **no-ops unknown `uploadId`s**. Three failures followed:

1. **Progress vanished on refresh / navigate-away.** A mid-ingestion refresh
   showed a blank panel though the Job was still running — the completion
   _notification_ still fired (the subscription was live post-refresh), but no
   per-file progress rendered: nothing re-seeded the reducer, and live events for
   an `uploadId` the fresh mount never authored were dropped.
2. **Duplicate filename.** After completion the panel kept rendering "Done" rows
   while the same files also appeared in `documents.list` below — each shown twice.
3. **Stuck at `queued` (clock skew).** The fresh-mount cursor `${Date.now()}-0`
   (`ingest-progress-reader.ts`) read the **app server's** clock while Redis
   assigns stream ids from **its own**. Under podman-VM drift the cursor landed in
   Redis' future, so `xRange` dropped every real stage event. A `podman machine`
   restart cleared it; host sleep re-introduced it.

Chat survives a refresh because it rehydrates from durable sources (a `chat.get`
Postgres snapshot + a `chat.inflightTurn` Redis lock seed the query cache, and a
head-replay reader resumes the token stream); ingest rehydrated from none. But
chat's stream is **per-turn** (bounded), whereas ingest's is **per-user**
(`ingestProgressKey(userId)`) — one firehose across every Job, retained 1h. So we
mirror chat's _principle_ (snapshot → resume-from-lastId), NOT its head-replay,
which would replay an hour of completed jobs and worsen the duplicate.

## Decision

1. **`documents.progressSnapshot` query — the durable seed.** A server fold
   (`ingest-progress-snapshot.ts`) of the retained per-user stream (`xRange('-',
'+')`, reusing `parseProgressEntry`) to the **latest stage per `uploadId`**,
   filtered to **in-flight + `failed`** (drop `done` — those already live in
   `documents.list`), returning `{ uploads, lastId }`. No new Postgres table: the
   stream is the durable store, bounded by its existing 1h TTL. This is ingest's
   `chat.get` + `chat.inflightTurn` collapsed into one.

2. **Seed the reducer, then resume the tail from `snapshot.lastId`.** On mount the
   hook `hydrate`s the reducer from the snapshot, then enables the subscription
   with `sinceId = lastId`. The reader cursor becomes
   `lastEventId ?? sinceId ?? '0-0'` — **every branch a real Redis stream id**.
   This is snapshot → resume-from-lastId: no replay, no gap. It also
   **structurally removes the clock-skew bug** — there is no `Date.now()` cursor
   left to skew (symptom #3 is fixed as a side effect, no separate `redis.time()`
   helper).

3. **Seed-on-unknown for live server stages.** A `serverStage` entry now carries
   the full wire identity (`jobId` + `filename`), so an event for an `uploadId`
   this mount never saw (post-refresh boundary, another tab) **materializes its own
   row** instead of being dropped — the safety net that renders late post-refresh
   events even if the snapshot missed them.

4. **Retire `done` rows on `documents.list` invalidation.** When a Job's Uploads
   all settle, the hook invalidates `documents.list` **and** `retire`s that Job's
   `done` rows from the reducer. The panel shows only in-flight + `failed`;
   completion is signalled by the existing notification toast. This kills the
   duplicate (symptom #2).

The IndexedDB persister (ADR 0025) is deliberately **not** used: progress is a
subscription-fed reducer, not a query; the server-side fold is multi-tab correct
and reuses durable data the stream already holds. The persister stays for
`documents.list`.

## Consequences

- **Positive.** A mid-ingestion refresh rehydrates in-flight per-file progress
  from the server and continues live; a completed file appears only in
  `documents.list`, never as a lingering "Done" row; the clock-skew class of
  "stuck at queued" cannot recur (a regression test injects an hour of skew and
  asserts events still deliver). No new persistence — the stream's 1h TTL is the
  only durability boundary.
- **Retired invariants.** This supersedes two entries in `packages/features/ingest/
CONTEXT.md`: the reader's _"tail-from-now… no cross-mount resume"_ (now
  snapshot → resume-from-lastId) and the framing of the Job as having no durable
  progress (its stream rows are now folded back on mount). The Job is still
  **derived, never persisted as a row**.
- **Accepted — `done`-but-Job-incomplete files blink out on refresh.** The
  snapshot drops `done`, and `documents.list` only refreshes on whole-Job
  completion, so a file that finished while its siblings are still in-flight
  disappears from the panel after a refresh until the Job completes (then it
  reappears in the list). Consistent with dropping `done` from the snapshot; the
  alternative (re-seeding `done`) reintroduces the duplicate.
- **Accepted — `failed` rows linger up to the 1h TTL.** A failed Upload stays in
  the snapshot (and so re-seeds on every refresh) until the stream expires. Desired
  — an operator wants failures to stay visible.
