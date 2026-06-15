import { clerkMiddleware } from '@clerk/tanstack-react-start/server';
import { createCsrfMiddleware, createStart } from '@tanstack/react-start';

/**
 * Same-origin guard for server functions. Server functions are RPC endpoints
 * invoked from our own client, so a cross-site request to one is always a CSRF
 * attempt. Scoped to `handlerType === 'serverFn'` so it leaves `router` requests
 * untouched — the Stripe webhook (`/api/stripe`) is a legitimate cross-origin
 * POST and the tRPC routes carry their own auth.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
});

/**
 * Global Start instance. Registering Clerk's request middleware here populates
 * the Start request context so `auth()` / `clerkClient()` work inside server
 * functions and API-route handlers — this is the TanStack Start side of the
 * app-owned auth seam (the Next.js app does the equivalent via its own
 * `@clerk/nextjs/server` resolver). See docs/adr/0003-framework-agnostic-auth-seam.md.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, clerkMiddleware()],
}));
