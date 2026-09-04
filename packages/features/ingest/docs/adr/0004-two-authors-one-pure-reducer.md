# Two authors, one pure reducer, forward-only stage ranks

**Status:** accepted — ticket #180, wired up in #189

## Context

Per-file progress has two authors that cannot be merged upstream. The client owns
`uploading` — the browser→S3 PUT, which the server never observes — and it also
knows a batch was accepted before any server event arrives. The server owns
`queued`, `parsing`, `embedding`, `done` and `failed`, delivered over the
progress stream.

So the two overlap and can arrive out of order. The client's optimistic `queued`
races the server's real `queued`. A transient reconnect redelivers events the
reducer has already seen. Post-refresh, live events arrive for `uploadId`s this
mount never authored. Any of these, applied naively, shows the operator a row
going backwards.

Two components need the same state from different places in the tree: the upload
trigger and the progress panel are not siblings.

## Decision

**One deep module: `useDocumentUpload`.** The three-step upload protocol, the
progress subscription, the snapshot hydration and the completion effect sit
behind the flat surface `{ upload, files, summary, accept, maxFileSizeBytes }`.
`UploadDocumentsButton` and `IngestProgress` stay UI-only and share **one hook
instance** through `IngestUploadProvider` (React context), which the app mounts
on the documents section — that is what keeps the subscription page-scoped rather
than component-scoped. Pure file validation stays outside React entirely, in
`src/lib/upload-validation.ts`.

**The merge is a pure reducer, and it has no `stateRef` intent triad.** The state
is a mount-owned `Record<uploadId, PerFileProgress>` plus a submission-order
array, folded by `ingestProgressReducer` — no React, no tRPC, unit-tested
standalone. Chat needs a `stateRef`/intent triad because its async callbacks read
state synchronously; nothing here does, so a plain `(state, event) => state`
suffices. `files`, `summary` and `completedJobIds` are pure per-render
derivations, never stored.

**Forward-only ranks make redelivery and the double-`queued` safe.**
`STAGE_RANK` orders `uploading < queued < parsing < embedding < done`, and a row
advances **only to a strictly greater rank**. That single rule absorbs the
optimistic-versus-real `queued` overlap, reconnect redelivery, and
out-of-order arrival without any of them being special-cased. `failed` is not
ranked — it is an absorbing terminal, because a failed Upload never re-enters the
pipeline (a retry is a fresh `uploadId`). `STAGE_RANK` is exported so the
progress bar derives its fill from the same table; a second ordering would be a
second source of truth.

**Failures surface where the operator can act on them.** Request-level failures
— validation, presign reject, `startIngestJob` reject — toast, because there is
no row to put them on. Per-file failures — a rejected PUT, a server `failed` —
render **in-list against the file** and are never toasted, because the operator
needs to know which of twelve files failed. Job completion is neither: it is the
app-level `ingest.job-complete` notification, so an operator who navigated away
still finds out. This hook deliberately raises no completion toast.

## Consequences

- **Positive.** The interesting logic — the two-author merge — is testable
  without React, a browser, or Redis. The hook is thin wiring.
- **Positive.** Every ordering hazard reduces to one comparison, so a new stage
  is one entry in `STAGE_RANK` rather than a new case in a merge function.
- **Progress is mount-owned, so it dies with the mount.** Nothing outside the
  hook can read it; surviving a reload takes a server round trip
  ([ADR 0001](0001-ingest-progress-survives-refresh.md)).
- **The provider must be mounted, and where it is mounted is a decision.** Put it
  above the whole app and the subscription outlives the page it serves; the two
  components silently share nothing if it is missing.
- **A stage can never be corrected downwards.** If the server ever needs to walk
  a row back — say `embedding` retried from `parsing` — the rank rule rejects it
  and the row stays ahead of reality until it terminates.
