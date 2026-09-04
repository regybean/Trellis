# The knowledge-base index is provisioned at boot, at a configured dimension

**Status:** accepted

`PgVector` creates `mastra_documents` lazily, on the first upsert. A freshly
pushed vector database therefore has no table, and a read (`listDocuments`)
fails with `relation … does not exist` — a read path broken by the absence of a
write. The vector dimension is a second lazily discovered fact: it is fixed when
the index is created, and the embed model that has to match it is chosen at
runtime by [`@acme/models`](../../../models/docs/adr/0001-multi-provider-models.md).

## Decision

**The index is created at boot, not on first upload.** Each app calls
`ensureVectorIndex()` from its boot path (Next.js `instrumentation.ts`, and each
worker entrypoint), so the table exists before any read. `uploadDoc` keeps its
own call as a memoised backstop rather than as the primary trigger.

**The dimension is env-derived, with one source of truth.**
`EMBED_DIMENSIONS` comes from `@acme/models/env` — imported from `/env`, never
from the package root, so loading the Drizzle schema cannot trigger provider
resolution. That one value feeds both the `PgVector` index (`vector.ts`) and the
Drizzle mirror (`schemas/documents-schema.ts`).

**A dimension mismatch fails with an actionable error.**
`ensureVectorIndex` describes an existing index first and throws naming both
dimensions and the fix ("drop the vector DB and re-push") when they disagree,
instead of letting every upsert fail deep inside pgvector. On failure the
memoised promise is cleared, so a transient database error can be retried
instead of poisoning every later upload.

## Why

- **Reads stay pure.** No read path runs DDL. Provisioning is a boot concern, so
  an unreachable or unprovisioned vector database fails at startup — the same
  contract provider resolution already has — rather than on a user's first
  request.
- **The dimension is not a constant we can bake in.** It is a property of the
  selected embed model, so it has to be configuration; having two definitions of
  it (index and mirror) is a silent-corruption bug waiting to happen.
- **Switching embed model is a re-push, and that is affordable.** Changing the
  model means changing the dimension and pushing the schema again. The dev vector
  database is ephemeral with no data worth migrating, so a loud failure plus a
  rebuild beats any migration machinery.

This does not change who owns the DDL: Mastra still runs it
([ADR 0001](0001-mastra-rag-and-memory.md)). `ensureVectorIndex` only decides
_when_ Mastra is asked to run it.

## Consequences

- Every runtime that reads the knowledge base must call `ensureVectorIndex()` in
  its boot path — an app that forgets gets the original lazy-creation behaviour
  back, silently, until a read precedes the first upload.
- `ensureVectorIndex` lives on `@acme/rag/server` (the pipeline entry) because
  both the pipeline and each app's boot call it.
- Re-pointing `MODELS_EMBED` at a model of a different dimension against a
  populated index is a hard stop, by design.
