# Indexing is one file at a time, with stage reporting injected

**Status:** accepted

Indexing is exposed as `uploadDoc(file, { onStage })`: one file's
`parse → chunk → embed → upsert`. There is no batch helper in `@acme/rag`, and
no knowledge here of streams, tRPC, `uploadId`s, or any wire shape.

## Decision

**One file per call, and the fan-out belongs to the caller.** The bounded
parallel fan-out over a set of files is the ingest processor's job
([`@acme/ingest`](../../../../features/ingest/CONTEXT.md)), which calls
`uploadDoc` per file.

**Idempotent by construction, not by checkpoint.** `deriveChunkId` is
`uuidv5(trimmed text + filename)`, and indexing upserts, so re-uploading a file
overwrites its chunks in place. Nothing has to remember what was already
uploaded.

**Stage reporting is injected and deliberately incomplete.** `uploadDoc` emits
only `parsing` and `embedding` through a generic
`StageReporter<TStage> = (stage: TStage) => void | Promise<void>`. The
`queued` / `done` / `failed` stages are the caller's, because only the caller
knows about queueing and about the batch a failure belongs to.

**One tagged error, everything else raw.** An empty or unparseable file throws
`DocumentParseError`, carrying the filename. Every other failure (parse, embed,
upsert) propagates untouched.

## Why

- **Per-file progress is the product requirement**, and it is only expressible
  if the unit of work is a file. The cost is real and accepted: one batched
  `embedMany` across all files becomes N per-file calls.
- **A batch helper here would be the wrong home for concurrency.** Bounding
  parallelism needs to know about the job, its progress stream, and its failure
  policy — all of which live in the feature. A batch API in the shared layer
  would either duplicate that or force the feature to fight it.
- **The generic reporter keeps the wire shape out.** A different pipeline (say a
  future `uploadStructuredDoc`) can carry a different stage vocabulary without
  `@acme/rag` learning what a subscription is. It is a plain generic, not a
  conditional-typed attribute.
- **`DocumentParseError` distinguishes a content failure from an infra
  failure.** That distinction is what lets a caller isolate one bad file and
  keep the rest of the batch green; an untagged `Error` would force it to guess
  from a message string.

## Consequences

- Embedding throughput is lower than a single batched call would give.
- A caller that wants `queued` / `done` / `failed` has to emit them itself;
  `uploadDoc`'s stage set alone does not describe a job's lifecycle.
- `dedupeChunks` collapses repeated content within a file to a single row, so
  chunk counts can be lower than the chunker's output.
