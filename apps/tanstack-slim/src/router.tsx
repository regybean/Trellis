import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';

import { createAppQueryClient } from '@acme/hooks';

import { routeTree } from './routeTree.gen';

/**
 * Router factory. This is where the app's ONE QueryClient is created (ADR 0036)
 * — every feature's queries run in it, namespaced by tRPC's `keyPrefix`. It is
 * also the client handed to the TanStack Start SSR query integration, so
 * server-rendered query state hydrates on the client.
 *
 * That combination is new. The feature `TRPCReactProvider`s mounted in `__root`
 * used to nest a QueryClient each, which **shadowed** this one: feature queries
 * could never participate in the SSR integration, whatever it was wired to. They
 * render no client of their own now, so nothing shadows it. Nothing prefetches a
 * feature query in a route loader today, so this changes no behaviour yet — it
 * removes the reason it couldn't.
 */
export function getRouter() {
  const queryClient = createAppQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  setupRouterSsrQueryIntegration({ router, queryClient });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
