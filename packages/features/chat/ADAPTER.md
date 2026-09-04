# Mounting `@acme/chat`

A conversational assistant: sessions, streamed generation, folders, and the
background worker that produces the tokens. The slice that exercises most of the
substrate at once, so mounting it touches every recipe.

## What it gives you

- A full assistant UI, or the conversation view alone if you want to build your
  own frame around it.
- Streamed responses over the tRPC transport your route seam already serves, so
  streaming needs no separate endpoint.
- Generation that survives a reload: the stream is durable, so a user who
  refreshes mid-answer rejoins it rather than losing it
  ([@acme/redis ADR 0001](../../platform/redis/docs/adr/0001-durable-redis-stream-primitive.md)).
- Conversation memory and retrieval through `@acme/rag`, and folders for
  organising sessions, with no wiring of your own beyond the table.
- Metering through the entitlements seam — a turn consumes credits and a failure
  refunds them — against whichever provider you injected.

## Surface

| Import              | What's in it                                     | Runs   |
| ------------------- | ------------------------------------------------ | ------ |
| `@acme/chat`        | Assistant UI, conversation view, provider, hooks | client |
| `@acme/chat/server` | Router, context factory, generation processor    | server |
| `@acme/chat/schema` | The folder table                                 | client |
| `@acme/chat/env`    | This package's env factory                       | either |

## Wiring

- Mount the router, serving GET as well as POST — the stream arrives over GET —
  and the provider with a server-resolved `scopeKey`
  ([trpc-route.md](../../../docs/mounting/trpc-route.md),
  [provider.md](../../../docs/mounting/provider.md)).
- Run the generation processor in your worker entrypoint, injecting the
  entitlements provider from your app's composition root — the one file that
  builds it, which your route seam imports too
  ([worker.md](../../../docs/mounting/worker.md)). A worker that builds its own
  refunds a ledger nobody is reading.
- Re-export the folder table from your schema barrel, and compose the env
  factory with a chat model selected
  ([schema.md](../../../docs/mounting/schema.md),
  [env.md](../../../docs/mounting/env.md)).
- Give the UI a route carrying an optional session id, passed in as a prop,
  plus the base path it lives under — [ui.md](../../../docs/mounting/ui.md).
  The feature keeps the address bar in sync itself, with the History API rather
  than your router, so a conversation is linkable without tearing the live
  stream ([ADR 0008](docs/adr/0008-deep-link-url-via-history-api.md)). Don't
  navigate on selection.
- Pass `renderMessageActions` if you want per-message UI — feedback buttons,
  copy, retry. Chat renders whatever you return beneath each settled assistant
  message and depends on none of it
  ([ADR 0007](docs/adr/0007-message-actions-render-slot.md)).
- Invalidate your credit display after a turn if you also mount billing. The
  features do not know about each other; your page wires the two together.

## Env

| Key                  | Class  | What it's for       |
| -------------------- | ------ | ------------------- |
| `NEXT_PUBLIC_WEBAPP` | secret | Your app's identity |

Plus nine profile-authored tunables: the credit charge per turn, the
stream-lifecycle timeouts, the reader's poll interval and the job-retention
counts. Each is env-overridable, so retuning one on a live deploy needs no
rebuild. See `src/env.ts`.

## Infra

`postgres` for sessions and retrieval, `redis` transitively for the queue and
the durable stream. Local inference only if a model role selects it —
[infra.md](../../../docs/mounting/infra.md).
