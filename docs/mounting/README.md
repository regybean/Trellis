# Mounting a Trellis package

Every runtime package under `packages/` carries an `ADAPTER.md`: what the
package gives an app, what it exposes to the client and to the server, and what
the app has to wire. Those documents stay short by linking here for the wiring
that is the same whichever package you are mounting.

Read the package's `ADAPTER.md` first. Come here when it sends you.

## What your app must already have

Two things, assumed by every package:

- **tRPC** on the server — the transport each feature's router mounts into.
- **React** on the client — the runtime each feature's provider and components
  need.

Which framework, which router, how you build and where you deploy are yours.

## The seams

`ADAPTER.md` files refer to places in your app by role, not by path. There are
eight, and each is whichever file in your app happens to play that part.

| Seam                  | What plays it                                                                     | Recipe                         |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| **route seam**        | The one place you turn a feature's tRPC router into your framework's HTTP handler | [trpc-route.md](trpc-route.md) |
| **per-feature route** | The file mounting one feature's router at one path                                | [trpc-route.md](trpc-route.md) |
| **provider tree**     | Where your React providers nest, above the pages that read them                   | [provider.md](provider.md)     |
| **schema barrel**     | The module your migration tool reads to decide which tables it manages            | [schema.md](schema.md)         |
| **env composition**   | The single `createEnv` call that composes each package's env factory              | [env.md](env.md)               |
| **worker entrypoint** | A long-lived process that drains background queues                                | [worker.md](worker.md)         |
| **compose file**      | Your local service definitions                                                    | [infra.md](infra.md)           |
| **style entrypoint**  | The CSS file your bundler reads, where Tailwind is told which sources to scan     | [ui.md](ui.md)                 |

## Client and server

Each `ADAPTER.md` has a **Surface** table listing the package's import
subpaths and where each one runs:

| Label    | Meaning                                                                     |
| -------- | --------------------------------------------------------------------------- |
| `client` | Safe in a browser bundle — components, hooks, providers, validation schemas |
| `server` | Server-side only. Drivers, routers, services, credentials                   |
| `either` | Genuinely safe on both; import it wherever you need it                      |

A feature's `.` subpath is its client surface and `./server` its router and
services. Most server surfaces carry an `import 'server-only'` marker, which
turns a client-side import into a build error rather than a browser bundle with
database code in it. Not all of them do — a package with no React dependency has
nothing to mark — so treat the label as the contract and the marker as the
enforcement where it exists.

Env factories are `either`: importing one is always safe, and the access guard
fires when client code reads a server-only key rather than when it imports the
module.

## Why these documents avoid your file paths

An `ADAPTER.md` that quoted a working app's files would have to be re-edited
every time that app moved one, and a document nobody re-edits is a document
that lies. So the recipes describe the shape of each seam and the contract it
has to satisfy, and point at real code for the rest.

## Reference implementations

The four apps in this repo mount these packages for real, across two frameworks
and two feature subsets:

- `apps/nextjs` and `apps/tanstack-start` — the same slices on Next.js and on
  TanStack Start.
- `apps/nextjs-slim` and `apps/tanstack-slim` — the same slices with no auth
  provider and no billing ([ADR 0010](../adr/0010-slim-no-auth-apps.md)).

Reading one alongside its `ADAPTER.md` is the fastest way to see a seam filled
in. Diffing two of them shows which parts are framework-specific.

## Related

- [feature-anatomy.md](../agents/feature-anatomy.md) — the inside of a feature
  package, for writing one rather than mounting one.
- [ADR 0015](../adr/0015-package-exports-convention.md) — the `exports`
  convention every **Surface** table reflects.
- [@acme/env ADR 0001](../../packages/platform/env/docs/adr/0001-one-env-factory-per-slice.md) — one env factory per
  slice, and the config/secret rule every **Env** table uses.
