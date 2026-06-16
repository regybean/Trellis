# @acme/feedback

Feature package scaffolded by `pnpm turbo gen feature`.

Included in this build:

- ✅ tRPC API router + server context (sample `items` entity)
- ✅ React UI (components, hooks, client provider)
- ✅ Backend tests (testcontainers + caller)
- ✅ Frontend tests (msw-trpc)

## Layout

```
src/
  api/
    trpc.ts                 # per-feature tRPC context + middleware (auth, rate limit, telemetry, db)
    root.ts                 # appRouter — aggregates routers
    routers/feedback.ts        # sample CRUD router
    schemas/item-schema.ts  # drizzle table + zod schemas
  env.ts                    # type-safe env (@t3-oss/env-nextjs)
  components/feedback-list.tsx # sample UI (presentational)
  hooks/use-feedback.ts        # data-access hook (tRPC + React Query)
  trpc/                     # client (react.tsx), RSC (server.tsx), query-client
  index.ts | index-server.ts | index-schema.ts   # public entrypoints
  tests/backend/            # setup, global-setup (testcontainers), utils, router tests
  tests/frontend/           # renderWithProviders + trpcMsw + component tests
```

## Testing

Run with `pnpm -F @acme/feedback test`.

### Backend (`test:backend`) — real DB, real Redis

Uses **testcontainers** (via `@acme/test-utils/setup`) so procedures run against
throwaway PostgreSQL + Redis containers. **Docker/Podman must be running.**

- Build a caller with `createTestContext(...)`, then call
  `appRouter.createCaller(ctx).feedback.<procedure>(...)`.
- Mock only what you don't own (Clerk auth, telemetry); exercise real persistence.
- Test shared middleware (auth, rate limit) **once**; cover business logic with the
  **zero / one / many** pattern; seed data with `fixtures.ts`.

### Frontend (`test:frontend`) — mocked tRPC, no DB

Uses **msw-trpc** + a real MSW `setupServer` to intercept the tRPC HTTP calls.
The provider switches to a plain `httpLink` when `NODE_ENV==='test'`.

```ts
server.use(trpcMsw.feedback.list.query(() => [/* rows */]));
renderWithProviders(<FeedbackList />);
```

## Wire it into an app (manual steps the generator can't do)

1. Add the dependency to the app: `"@acme/feedback": "workspace:*"`.
2. Add the API route handler:

   ```ts
   // apps/nextjs/src/app/api/trpc/feedback/[trpc]/route.ts
   import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

   import { appRouter, createTRPCContext } from '@acme/feedback/server';

   const handler = (req: Request) =>
     fetchRequestHandler({
       endpoint: '/api/trpc/feedback',
       req,
       router: appRouter,
       createContext: () => createTRPCContext({ headers: req.headers }),
     });

   export { handler as GET, handler as POST };
   ```

3. Wrap the relevant tree with `FeedbackTRPCReactProvider` (from `@acme/feedback`).
4. Register the schema for migrations (drizzle config `schema` glob), then `pnpm db:push`.
