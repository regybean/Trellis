# Recipe: infrastructure

A package that talks to a backing service declares it in its `package.json`
under `acme.infra` — a list of service names, not a compose file
([ADR 0009](../adr/0009-graph-derived-dev-infra.md)). Your app's required
infrastructure is the union of that field across everything it depends on,
directly or transitively.

Each `ADAPTER.md` **Infra** section names what the package declares.

## 1. What you have to provide

For each service in the union, a reachable instance and the connection values
its owning package's env expects ([env.md](env.md)). How you provide it is
yours: a compose service locally, a managed service in a deployment, or a
container your CI starts.

The services packages in this repo declare:

| Service      | What needs it                                 |
| ------------ | --------------------------------------------- |
| `postgres`   | Anything owning tables, and vector search     |
| `redis`      | Queues, credit ledgers, notification streams  |
| `localstack` | S3-compatible object storage for uploads      |
| `ollama`     | Local model inference, when a role selects it |
| `jaeger`     | An OTLP trace collector                       |
| `billing`    | A local Stripe stand-in                       |

## 2. Some services are conditional

A service in the dependency union is not always required. Two are decided by
configuration rather than by the graph:

- The local Stripe stand-in is unnecessary if you point at real Stripe.
- Local inference is unnecessary if every model role selects a hosted provider.

So the resolved set is the graph's union, pruned by the authored configuration.
A package whose `ADAPTER.md` says its infra is conditional is one of these: read
its **Env** section to see which value decides.

The pruning reads authored configuration, not `process.env`, because it decides
what to _provision_ — an operator's override of a connection string should not
change which containers start.

## 3. Transitive declarations

You will need services no package you import declares directly. A feature that
enqueues work pulls in the queue package, which declares Redis; you never
imported the queue package yourself. This is why the union is over the whole
closure rather than over your direct dependencies, and why an `ADAPTER.md`
**Infra** section can list a service the package's own code never connects to.

## 4. Tests provision their own

Backend test suites start throwaway containers per suite and tear them down
after ([ADR 0034](../adr/0034-backend-tests-always-self-provision.md)). They do
not use your development services, and running tests needs no infrastructure
started by hand — only a reachable container runtime.
