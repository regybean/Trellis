# App (`apps/service-host`)

A generic, standalone Node.js tRPC backend that mounts **exactly one** feature
slice's router, selected at boot by env. The atomic unit of an opt-in
microservices showcase: run three of these (`chat`, `ingest`, `feedback`), each
on its own port, and you have the same feature routers the monolith apps mount,
split into separate processes. **Local / demo scope only** — no auth (Clerk), no
billing (Stripe).

Owns no business logic and no UI. It is a host: a registry, a context resolver,
and an HTTP bridge.

## The contract

Two env vars drive it:

- **`FEATURE`** — one of `chat` | `ingest` | `feedback`. Selects the registry
  entry.
- **`PORT`** — the port to listen on.

On boot it logs one line: which feature on which port at which endpoint (e.g.
`mounted "chat" on port 4001 at /api/trpc/chat`).

## Language

**Feature registry** (`src/registry.ts`):
The single map `FEATURE -> { import: () => import('@acme/<feature>/server'), endpoint }`.
The import is a deferred thunk, so booting transpiles/loads only the ONE selected
feature's server graph. Every feature's `/server` seam is uniform:
`{ appRouter, createTRPCContext }` (ADR 0015 bounded exports). Adding a feature =
one entry.

**Constant principal** (`src/trpc-context.ts`):
Copied verbatim from `apps/tanstack-slim`'s `src/lib/trpc-route.ts` — the fixed
`InjectedAuth` `{ userId: 'local', sessionClaims: { metadata: { role: 'admin' } } }`
injected in place of Clerk, with `user: null` and `unlimitedEntitlements` in place
of billing. See ADR 0003 / ADR 0006 / ADR 0010.
_Avoid_: "fake user", "mock auth".

**Fetch handler + HTTP bridge** (`src/server.ts`):
Reuses `createTRPCFetchHandler` from `@acme/trpc/handler` (shared fetch-adapter
wiring, structured error logging, CORS). Its `(req: Request) => Response` output
is bridged to `node:http` via `@whatwg-node/server`'s `createServerAdapter`. The
same GET handler carries `httpSubscriptionLink` SSE (e.g. `chat.stream`), so
streaming works with no extra wiring.

## Runtime gotchas

**TS source at runtime** — feature `exports` `default` point at `./src/*.ts`
(ADR 0015), so there is no compiled JS to run. The entrypoint runs under `tsx`
(`pnpm with-env tsx src/server.ts`), which transpiles the whole
`@acme/<feature>/server` graph on the fly. `build`/`typecheck` are `tsc --noEmit`.

**`server-only` throws** — `@acme/trpc` and each feature's `index-server.ts`
begin with `import 'server-only'`, which throws unless the `react-server` export
condition is set (a Next.js guard). This is a plain Node process with no client
bundle, so the guard is irrelevant. `tsconfig.json` remaps the bare `server-only`
specifier to `src/stubs/server-only.ts` (an empty module) via `paths`; `tsx`
honors tsconfig paths. This is the plain-node analogue of the `stubServerOnly`
Vite plugin in `apps/tanstack-slim`.

## Structure

| Path                       | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `src/server.ts`            | Entrypoint — read env, select feature, mount router, listen        |
| `src/registry.ts`          | `FEATURE -> { import, endpoint }` map + `FeatureName` guard        |
| `src/trpc-context.ts`      | Constant local principal + unlimited entitlements resolver         |
| `src/stubs/server-only.ts` | Empty-module stub for the `server-only` guard (via tsconfig paths) |

## Relationships

- Depends on `@acme/chat`, `@acme/ingest`, `@acme/feedback` (each `/server`),
  plus `@acme/trpc`, `@acme/entitlements`, `@acme/logger`, `@acme/env`.
- No Clerk, no Stripe, no `@acme/auth` / `@acme/billing` / `@acme/subscriptions`.
- The selected feature's server graph still needs Postgres (and the feature's own
  infra) at request time — this host does not provide it; the showcase's compose
  stack does.
