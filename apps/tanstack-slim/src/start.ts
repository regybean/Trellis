import { createCsrfMiddleware, createStart } from '@tanstack/react-start';

/**
 * Same-origin guard for server functions. Server functions are RPC endpoints
 * invoked from our own client, so a cross-site request to one is always a CSRF
 * attempt. Scoped to `handlerType === 'serverFn'` so it leaves `router` requests
 * untouched — the tRPC routes carry their own context.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
});

/**
 * Global Start instance. The slim app strips Clerk, so no auth middleware is
 * registered here — the tRPC route seam injects a constant local principal
 * instead (see `src/lib/trpc-route.ts`). Only the CSRF guard remains.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}));
