# Mounting `@acme/auth`

This package ships a **factory**, a **principal mapper** and a **schema** — no
React, no route, no singleton. The app builds the instance, mounts the catch-all
route, builds its own browser client, and re-exports the schema so drizzle-kit
manages the tables. Four things, and each one is app-owned for a stated reason
(ADR 0003, ADR 0034).

There is no `.` export: `./server`, `./schema` and `./env` only.

## Mounted by

- `apps/nextjs` — `src/server/auth.ts`, `src/app/api/auth/[...all]/route.ts`,
  `src/lib/auth-client.ts`, `src/server/trpc-route.ts`, `src/server/db/schema.ts`,
  `src/env.ts`, `src/middleware.ts`
- `apps/tanstack-start` — `src/lib/auth-server.ts`, `src/routes/api/auth.$.ts`,
  `src/lib/auth-client.ts`, `src/lib/auth.ts`, `src/lib/trpc-context.ts`,
  `src/server/db/schema.ts`, `src/env.ts`

The slim apps mount **none** of it — they inject a constant principal instead
(ADR 0010). Keeping this package out of their graph is what proves the seam.

## Glue

### 1. Build the instance — `apps/nextjs/src/server/auth.ts`

```ts
import 'server-only';

import { initAuth } from '@acme/auth/server';

import { env } from '~/env';

export const auth = initAuth({ baseUrl: env.BETTER_AUTH_URL });
```

`initAuth` takes `baseUrl` rather than reading it because each app binds its own
port and its own deployed origin, and a shared-layer package must not read app
env. One instance per server runtime, shared by the route handler, the session
resolver and the admin actions, so they cannot disagree about configuration.

### 2. Mount the catch-all — `apps/nextjs/src/app/api/auth/[...all]/route.ts`

```ts
import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '~/server/auth';

export const { GET, POST } = toNextJsHandler(auth);
```

TanStack Start — `apps/tanstack-start/src/routes/api/auth.$.ts`:

```ts
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
```

The path is `/api/auth/...` because that is Better Auth's default `basePath`,
which the browser client also defaults to. Change one without the other and every
call breaks. Keep the route outside any signed-in guard — gating the sign-in
endpoints behind a signed-in check is a redirect loop.

### 3. Build the browser client — `apps/nextjs/src/lib/auth-client.ts`

```ts
import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ plugins: [adminClient()] });
```

No `baseURL` — the routes are served by the same app at the default base path, so
the client's own origin is already correct on localhost and every deploy target.
`adminClient()` mirrors the server's `admin()` plugin; both must be present or
the client's methods and the server's routes disagree. There is no provider to
mount: the client keeps session state in a nanostore and `useSession()`
subscribes to it directly.

### 4. Map onto the neutral principal — `apps/nextjs/src/server/trpc-route.ts`

```ts
import { toPrincipal } from '@acme/auth/server';

const resolveSession = async (req: Request) => ({
  user: toPrincipal(await auth.api.getSession({ headers: req.headers })),
});
```

Resolution is app-owned; the mapping is not. `toPrincipal` is shared by both full
apps because it is provider-specific rather than framework-specific (ADR 0003).
The Better Auth session object never reaches the tRPC context — the principal
carries only what the substrate and features read.

Pass the **request's** headers, not the framework's ambient headers, so the
resolution is tied to the request being served.

Reading the role needs `readSessionRole` rather than a property access:

```ts
// apps/tanstack-start/src/lib/auth.ts
role: readSessionRole(session.user),
```

Better Auth types `getSession` as returning the core columns only, so the admin
plugin's `role` is a runtime fact with no static promise behind it.

### 5. Re-export the schema — `apps/nextjs/src/server/db/schema.ts`

```ts
// Better Auth's tables, in their own `auth` Postgres schema rather than
// `appSchema` — identity is shared across the apps on one database (ADR 0035).
export {
  authSchema,
  authUser,
  authSession,
  authAccount,
  authVerification,
} from '@acme/auth/schema';
```

And list `auth` in the drizzle configs' `schemaFilter`, or push ignores the
tables entirely:

```ts
schemaFilter: [process.env.NEXT_PUBLIC_WEBAPP ?? 'nextjs', 'auth'],
```

### 6. Route gating is app-owned

Next.js does it in `src/middleware.ts` with `getSessionCookie` — an **optimistic
redirect, not an authorisation check** (Edge has no database, and sessions here
are rows with the cookie cache off). TanStack Start does the equivalent with a
`createServerFn` (`src/lib/auth.ts`) feeding route `beforeLoad` guards. Either
way, real authorisation happens at the procedure.

### 7. Session cost

Every request is a database read of the session row, by design: sessions are
stateful and the cookie cache is off, so a revoked session stops authenticating
immediately (ADR 0034).

## Env

Factory: `src/env.ts`, exported as `@acme/auth/env` (`betterAuthEnv()`).

| Key                  | Kind   | Owner       | Notes                                                                                                                                                         |
| -------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | secret | this slice  | the one key the slice reads; generate with `openssl rand -base64 32`. Without it Better Auth silently falls back to its hardcoded development secret          |
| `BETTER_AUTH_URL`    | config | **the app** | authored per app (`http://localhost:3000` for `nextjs`, 3001 for `tanstack-start`) — the origin the routes are mounted on, which a shared package cannot know |

The split is deliberate and settled (#239): the slice declares only what it
reads.

## Infra

`acme.infra: ["postgres"]` → the `postgres` profile in `deploy/compose.yaml`. The
tables live in a dedicated `auth` Postgres schema, not the per-app one, because
identity is shared across apps on one database (ADR 0035).

## Also mount

`@acme/db` (the connection and the drizzle-kit configs), `@acme/env`,
`@acme/trpc`, `@acme/ui` (the `SignInForm` / `SignUpForm` / `UserButton`
components the apps render). Add `better-auth` to the app's own dependencies —
`toNextJsHandler`, `createAuthClient` and `getSessionCookie` are imported
directly from it in app files.
