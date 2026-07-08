# Opt-in microservices topology: one generic host per feature behind a gateway

Trellis already proves the slice contract along two axes: the same feature
slices run on two frameworks (`nextjs` / `tanstack-start`) and as a reduced
no-auth/no-billing subset (the `*-slim` apps, [ADR 0010](0010-slim-no-auth-apps.md)).
This adds a third axis — the same slices deployed as **separate processes, one
backend per feature** — without editing any feature code. It is an opt-in,
local/demo-only showcase: proof that a slice is portable across deployment
topologies, not a production runtime.

The whole thing hangs off one property that already existed: every app mounts a
feature router through the same framework-agnostic `createTRPCFetchHandler`
(`@acme/trpc/handler`), and the app owns only three things at that seam — the
HTTP route, the **auth resolver**, and **entitlements injection**. So "turn a
router into a standalone backend" is: give that handler a standalone Node server
and a slim-style resolver. The router, hooks, and UI are untouched.

## Decisions

### 1. One generic `service-host`, not N bespoke app dirs

A single `apps/service-host` mounts _any_ feature's `appRouter`, selected at boot
by a `FEATURE` env var against a static registry (`chat` → `@acme/chat/server`,
etc.). One image, run N times with different `FEATURE`/`PORT`.

This deliberately softens the "apps own their shell" doctrine: the shell here is
generic deployment infrastructure, not product chrome. N near-identical
~40-line app dirs would rot out of sync; a single parametric host cannot. The
cost is that `service-host` depends on _every_ mountable feature, so its infra
closure is the union of all of them — acceptable for a heavy opt-in target.

### 2. Reverse-proxy gateway, not per-feature client URLs

The frontend keeps calling same-origin `/api/trpc/<feature>` exactly as in the
monolith. A Caddy gateway fans out by path prefix
(`/api/trpc/chat/*` → chat service, etc.) and serves everything else from the
frontend.

The rejected alternative — making the tRPC client's base URL configurable per
feature — would have leaked deployment topology into the feature packages
(breaking the slice contract: a feature must not know where it is deployed) and
forced CORS + preflight on every service. The gateway keeps every request
same-origin, so **not one line of feature client code changes** and CORS never
enters the picture. The routing table (one Caddyfile) is the only new artifact
that knows the topology.

### 3. Shared deployment namespace

All services connect to the **same** Postgres schema and Mastra tables:
`NEXT_PUBLIC_WEBAPP` is one deployment-wide value, not per-service. Services
share data by sharing the namespace, exactly like the monolith — `ingest` writes
the pgvector store `chat` reads; `feedback` and `chat` share Mastra thread
ownership (`assertThreadOwned`). Per-service namespaces would fragment the schema
and break that sharing.

### 4. DDL owned by a one-shot migrator

A single migrate step runs `db:push` (creates the shared schema + the app-owned
`chatFolder` table) and `ensureVectorIndex()` **once, before any service starts**.
Services boot stateless and assume the schema exists. This keeps ADR 0002/0010's
"`db:push` owns `CREATE SCHEMA`, Mastra owns `mastra_*` at runtime" invariant —
just relocated from a single app's `instrumentation.ts` to a dedicated migrate
container. The rejected alternative (each service self-heals via
`ensureVectorIndex()` on boot) races N idempotent DDL calls and duplicates boot
logic in the generic host.

### 5. RSC / server-side tRPC caller is unsupported here

The monolith's RSC / server-side caller (`trpc/server.tsx`) creates an
**in-process** tRPC caller. In this topology the frontend process has no router
in-process, so a server-side caller has nothing local to call. SSR data-prefetch
is therefore out of scope for this showcase — the client fetches through the
gateway after hydration. This is an accepted limitation, not a bug to fix; making
it work would mean proxying the in-process caller over HTTP, which the client
path already does.

### 6. Local/demo scope, no auth

Every service injects `LOCAL_PRINCIPAL` (`role: admin`) + `unlimitedEntitlements`
— the same seams the slim apps use ([ADR 0010](0010-slim-no-auth-apps.md)) — so
the dependency graph carries no Clerk and no Stripe/Redis billing. Services are
reachable only behind the gateway on localhost via podman compose. Real auth
between browser↔gateway, service-to-service trust, TLS, and secrets are out of
scope; adding them would reintroduce the exact seams this subset drops and would
warrant its own ADR.

## Consequences

- **New: `apps/service-host`** — the generic Node host. Runs feature TypeScript
  source directly via `tsx` (features export `default` → `./src/*.ts` per
  [ADR 0015](0015-package-exports-convention.md); a standalone Node server has no
  bundler to transpile them, and JIT-running the whole graph is the "heavy" this
  target embraces). `import 'server-only'` (bare in `@acme/trpc`) throws outside a
  `react-server` condition, so the host stubs it to an empty module — the plain
  Node analogue of the slim app's Vite `stubServerOnly` plugin. Uses
  `@whatwg-node/server` to bridge `node:http` ↔ the fetch handler, preserving
  chat's SSE subscription stream.
- **New: `apps/micro-web`** — a client-only TanStack frontend: the slim app minus
  its `/api/trpc/*` route mounts and minus every `@acme/*/server` import. It ships
  the feature _client_ surfaces (components/hooks/providers) unchanged, so its
  image drops the backend routers and the split is real.
- **New: `caddy/micro.Caddyfile`, `compose.micro.yml`, `pnpm micro:up`** — the
  gateway routing table, the standalone compose stack (migrate → services →
  gateway → frontend), and the sole entrypoint. None are referenced by `pnpm dev`
  or `pnpm infra:up`; the topology is invisible to the normal workflow.
- **`@acme/feedback` lost a dead `@clerk/nextjs` dependency** it never imported
  (only comments referenced it), bringing it in line with the other no-auth
  features so it can run under a slim-style host.

## Status

accepted

## Considered and rejected

- **N bespoke service app dirs.** Rejected — near-identical shells rot; a
  parametric host stays single-sourced. (Decision 1.)
- **Configurable per-feature client base URL.** Rejected — leaks topology into
  feature packages and forces CORS on every service. The gateway keeps callers
  same-origin and unchanged. (Decision 2.)
- **Per-service `NEXT_PUBLIC_WEBAPP` namespace.** Rejected — fragments the shared
  Postgres schema + Mastra tables and breaks cross-feature data sharing. (Decision 3.)
- **Each service runs `ensureVectorIndex()` on boot.** Rejected — races N
  idempotent DDL calls and duplicates boot logic; a one-shot migrator is a single
  owner. (Decision 4.)
- **Reusing `tanstack-slim` as the frontend.** Rejected — it still bundles every
  feature router server-side (dead code + full infra closure), so the frontend
  would not actually be decoupled from the backends.
- **The Node standalone tRPC adapter (`@trpc/server/adapters/standalone`).**
  Rejected — its context receives Node `IncomingMessage`/`ServerResponse`, but
  the feature `createTRPCContext` types `headers` as a web `Headers` and `req` as
  a web `Request` and reads `ctx.headers.get(...)`. Fitting Node objects would
  need a banned `as` cast; the fetch adapter (via `@whatwg-node/server`) provides
  a real web `Request` and lets the host reuse the shared `createTRPCFetchHandler`
  (error logging + CORS that "can't drift per app").
