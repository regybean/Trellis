import { createCsrfMiddleware, createStart } from '@tanstack/react-start';

/**
 * Same-origin guard for server functions. Server functions are RPC endpoints
 * invoked from our own client, so a cross-site request to one is always a CSRF
 * attempt. Scoped to `handlerType === 'serverFn'` so it leaves `router` requests
 * untouched — the Stripe webhook (`/api/stripe`) is a legitimate cross-origin
 * POST, the Better Auth catch-all (`/api/auth/$`) does its own origin check
 * against `baseURL`/`trustedOrigins`, and the tRPC routes carry their own auth.
 *
 * Global Start instance. Auth registers **no** request middleware here: Better
 * Auth resolves a session from the request's own `Cookie` header (`lib/auth.ts`,
 * `lib/trpc-context.ts`), so there is nothing to install and no ordering to get
 * right — auth is never ambient (@acme/auth ADR 0001).
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}));
