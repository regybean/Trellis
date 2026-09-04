# Mounting `@acme/ingest`

Document upload and indexing. Files go to object storage, a background job
extracts and indexes them, and the browser watches progress that survives a
reload ([ADR 0001](docs/adr/0001-ingest-progress-survives-refresh.md)).

## What it gives you

- An upload control and a document list, ready to drop on a page.
- A progress view fed by a per-user stream, so a user who reloads mid-batch
  rejoins the progress rather than losing it.
- A background processor that extracts text, chunks it and indexes it into
  `@acme/rag`'s vector store, with bounded concurrency so a large batch cannot
  exhaust memory.
- A completion notification through `@acme/notifications`, so a user who
  navigated away still finds out.

## Surface

| Import                | What's in it                                      | Runs   |
| --------------------- | ------------------------------------------------- | ------ |
| `@acme/ingest`        | Upload control, document list, progress, provider | client |
| `@acme/ingest/server` | Router, context factory, processor                | server |
| `@acme/ingest/env`    | This package's env factory                        | either |

This slice owns no tables. Documents live in object storage and their chunks in
the vector store, so there is no `./schema` subpath and nothing to re-export.

## Wiring

- Mount the router, and the provider with a server-resolved `scopeKey`
  ([trpc-route.md](../../../docs/mounting/trpc-route.md),
  [provider.md](../../../docs/mounting/provider.md)).
- Run the processor in your worker entrypoint. It takes no arguments: it neither
  reads nor writes entitlements — [worker.md](../../../docs/mounting/worker.md).
- Put the components on a page of yours. The upload control and the document
  list are separate, so they need not sit together —
  [ui.md](../../../docs/mounting/ui.md).
- Compose the env factory, select an embedding model and provide a bucket
  ([env.md](../../../docs/mounting/env.md)). Mount `@acme/notifications` too if
  you want completion messages: without it, indexing finishes silently.

## Env

| Key                     | Class           | What it's for             |
| ----------------------- | --------------- | ------------------------- |
| `NEXT_PUBLIC_WEBAPP`    | secret          | Your app's identity       |
| `AWS_ACCESS_KEY_ID`     | config → secret | Object-storage credential |
| `AWS_SECRET_ACCESS_KEY` | config → secret | Object-storage credential |

The credential pair is authored for the local storage stand-in in development and
removed on staging and production, so a real deploy must supply it. Plus nine
profile-authored tunables: region, endpoint and bucket, the progress stream's
retention and poll bounds, the worker's concurrency and the job-retention counts.
See `src/env.ts`.

## Infra

`localstack` for S3-compatible storage locally. Point the endpoint at real
object storage instead and the local service drops out. `postgres` and `redis`
arrive transitively through retrieval and the queue —
[infra.md](../../../docs/mounting/infra.md).
