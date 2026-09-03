# Mounting `@acme/rag`

Retrieval and conversational memory. Features use it to store and search
document chunks and to recall prior turns
([ADR 0002](docs/adr/0001-mastra-rag-and-memory.md)). Your app provides
the database, creates the index at boot, and keeps the runtime-owned tables away
from its migration tool.

## What it gives you

- A vector store over Postgres, so retrieval needs no second database.
- Conversational memory — recent turns plus semantic recall — that features read
  without managing history themselves.
- Text extraction from uploaded documents, and chunking with configurable size
  and overlap.
- `ensureVectorIndex` — the boot-time call that creates the knowledge-base index
  if it is absent.
- Thread-ownership assertions, so a feature cannot read a conversation
  belonging to another principal.

## Surface

| Import                     | What's in it                           | Runs   |
| -------------------------- | -------------------------------------- | ------ |
| `@acme/rag`                | Vector store, memory, ownership checks | server |
| `@acme/rag/server`         | Extraction, chunking, index creation   | server |
| `@acme/rag/schema`         | The memory tables, for querying        | client |
| `@acme/rag/ownership-trpc` | Ownership guards for procedures        | server |
| `@acme/rag/env`            | This package's env factory             | either |

## Wiring

- Call `ensureVectorIndex` at boot, in the same place you initialise telemetry,
  and in your worker entrypoint too.
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

Plus six profile-authored tunables: the vector database name, chunk size and
overlap, and the memory recall bounds. Each is overridable by an environment
variable of the same name. See `src/env.ts`.

## Infra

`postgres` for both the vector store and memory. Local inference is needed only
if an embedding role selects it — `@acme/models` decides that
([infra.md](../../../docs/mounting/infra.md)).
