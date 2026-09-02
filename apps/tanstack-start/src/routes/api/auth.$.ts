import { createFileRoute } from '@tanstack/react-router';

import { auth } from '~/lib/auth-server';

/**
 * Better Auth's catch-all. Every credential operation the browser performs —
 * `sign-up/email`, `sign-in/email`, `get-session`, `sign-out` — is an HTTP call
 * to a path under this mount, and `auth.handler` is a plain
 * `(Request) => Response`, so the whole provider needs exactly this one route.
 *
 * `/api/auth` is Better Auth's default base path, and it is left at the default:
 * `createAuthClient` in `lib/auth-client.ts` assumes the same default, so the
 * path is agreed by convention rather than configured twice.
 *
 * The route sits outside the `beforeLoad` guards on purpose — gating the sign-in
 * endpoints behind a signed-in check is a redirect loop.
 */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
