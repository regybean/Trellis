# Mounting `@acme/rag`

Retrieval and conversational memory. Features use it to store and search
document chunks and to recall prior turns
([ADR 0001](docs/adr/0001-mastra-rag-and-memory.md)). Your app provides
the database, creates the index at boot, and keeps the runtime-owned tables away
from its migration tool.

## What it gives you

- A vector store over Postgres, so retrieval needs no second database.
- **Data Sources** — the user-owned partitions the knowledge base is divided
  into, with their table, their caps, and every read and write of them behind one
  server-only module. A feature that manages them (`@acme/ingest`) and a feature
  that retrieves from them (`@acme/chat`) both reach them here rather than each
  holding their own database client.
- **Retrieval scope** — `resolveRetrievalScope` turns a caller's chosen Source
  ids into the trusted request context an agent is given: the metadata filter,
  built from the verified `userId` and never from the request, plus the
  server-pinned `topK`. That filter is the privacy boundary, so the filter
  builder is deliberately not exported
  ([ADR 0006](docs/adr/0006-the-retrieval-filter-is-the-privacy-boundary.md)).
- Conversational memory — recent turns plus semantic recall — that features read
  without managing history themselves.
- Text extraction from uploaded documents, and chunking with configurable size
  and overlap.
- `ensureVectorIndex` — the boot-time call that creates the knowledge-base index
  if it is absent.
- Thread-ownership assertions, so a feature cannot read a conversation
  belonging to another principal, and the matching Data Source ownership rule in
  both its forms — rejecting for a mutation, narrowing for a retrieval scope
  ([ADR 0005](docs/adr/0005-retrieval-scope-narrows-rather-than-rejects.md)).

## Surface

| Import                     | What's in it                                        | Runs   |
| -------------------------- | --------------------------------------------------- | ------ |
| `@acme/rag`                | Vector store, memory, thread ownership              | server |
| `@acme/rag/server`         | Data Sources, retrieval scope, extraction, indexing | server |
| `@acme/rag/schema`         | The memory tables and `data_source`, for querying   | client |
| `@acme/rag/ownership-trpc` | Ownership guards for procedures                     | server |
| `@acme/rag/env`            | This package's env factory                          | either |

## Wiring

- Call `ensureVectorIndex` at boot, in the same place you initialise telemetry,
  and in your worker entrypoint too — reads do not create the index
  ([ADR 0002](docs/adr/0002-knowledge-base-index-provisioned-at-boot.md)).
- Re-export `dataSource` from `@acme/rag/schema` in your app's schema barrel, so
  drizzle-kit pushes it. It is an **app-owned** table, unlike everything else
  here — [schema.md](../../../docs/mounting/schema.md).
- Do **not** re-export the memory tables from your schema barrel. The library
  owns their DDL and creates them at runtime; handing them to your migration
  tool makes the next push drop them. Exclude them by name pattern in your
  migration config instead, and import the schema directly when you want to
  query them — [schema.md](../../../docs/mounting/schema.md).
- Compose the env factory, and select an embedding provider through
  `@acme/models` — [env.md](../../../docs/mounting/env.md).
- Provide Postgres with vector support —
  [infra.md](../../../docs/mounting/infra.md).

## Env

| Key                  | Class  | What it's for                                   |
| -------------------- | ------ | ----------------------------------------------- |
| `NEXT_PUBLIC_WEBAPP` | secret | Your app's identity — becomes its schema prefix |

Plus nine profile-authored tunables: the vector database name, chunk size and
overlap, the memory recall bounds, the two Data Source caps (per user, and
Documents per Source) and the retrieval `topK`. Each is overridable by an
environment variable of the same name. See `src/env.ts`.

The caps and `topK` live here rather than in the features that enforce them,
because this package owns the entity they bound — `@acme/ingest` reads the caps
at presign, and `topK` is pinned into every retrieval scope so the number is the
server's rather than the model's.

## Infra

`postgres` for both the vector store and memory. Local inference is needed only
if an embedding role selects it — `@acme/models` decides that
([infra.md](../../../docs/mounting/infra.md)).
