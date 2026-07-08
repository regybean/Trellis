# micro-web

The client-only frontend for the opt-in microservices showcase ([ADR 0023](../../docs/adr/0023-opt-in-microservices-topology.md)).

It is `apps/tanstack-slim` with the backend removed: **no `/api/trpc/*` route
mounts, no `@acme/*/server` imports, no DB ownership**. It ships the feature
_client_ surfaces — `ChatTRPCReactProvider`, `IngestTRPCReactProvider`, their
hooks and components — unchanged from the slim app. Because the base URL stays
same-origin (`window.location.origin + /api/trpc/<feature>`), the client callers
are byte-for-byte identical to the monolith; the gateway (`:3000`) is what routes
each `/api/trpc/<feature>` prefix to the matching service process.

What differs from `tanstack-slim`:

- `src/routes/api/trpc/*` and `src/lib/trpc-route.ts` — **deleted** (routers live
  in `apps/service-host` processes now).
- `src/server/`, drizzle configs, `migrations/` — **deleted** (DDL owned by
  `apps/micro-migrate`).
- `src/nitro/telemetry.ts` — trimmed to telemetry init only; it no longer resolves
  model providers or runs `ensureVectorIndex()` (the migrator owns that).
- Dev server on `:3100`, behind the gateway.

SSR data-prefetch via an in-process tRPC caller is **not supported** here (ADR
0023 decision 5) — the routers aren't in this process. Data loads client-side
through the gateway after hydration.
