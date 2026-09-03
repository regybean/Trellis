# Mounting `@acme/queue`

Background work. Features that do something slow enqueue a job and return; your
app runs the process that drains the queue
([worker.md](../../../docs/mounting/worker.md)).

## What it gives you

- `createQueue` and `createWorker` — producer and consumer factories, already
  connected to Redis and already prefixed with your app's identity, so two apps
  on one Redis never consume each other's jobs.
- `QUEUE_NAMES` — the shared name registry. Producer and consumer agree by
  importing the same constant instead of matching string literals.
- Graceful-shutdown handles, so a redeploy drains in-flight work rather than
  orphaning it.

## Surface

| Import        | What's in it                      | Runs   |
| ------------- | --------------------------------- | ------ |
| `@acme/queue` | Queue and worker factories, names | server |

## Wiring

- Run a worker entrypoint. Without one, jobs enqueue and nothing happens — the
  requests still succeed, which makes this the quietest thing to leave out.
  [worker.md](../../../docs/mounting/worker.md)
- Run it as your app's own process, inheriting your app's env, so its namespace
  and prefix match the app that enqueued the work.
- Provide Redis — [infra.md](../../../docs/mounting/infra.md).
- Compose the env factory of any package that enqueues; retention and retry
  settings belong to the feature, not to this package.

## Env

| Key                  | Class  | What it's for                                  |
| -------------------- | ------ | ---------------------------------------------- |
| `NEXT_PUBLIC_WEBAPP` | secret | Your app's identity — becomes the queue prefix |

Plus the environment selector, profile-authored. This package declares no
tunables of its own. See `src/env.ts`.

## Infra

`redis`. Pulled in transitively by every feature that queues work, so you will
need it even if you never import this package yourself.
