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
 * Global Start instance. This is a client-only frontend (ADR 0023): the feature
 * tRPC routers run in separate service processes reached through the gateway, so
 * this app mounts no `/api/trpc/*` routes and registers no auth middleware. Only
 * the CSRF guard for any server functions remains.
 */
export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}));
