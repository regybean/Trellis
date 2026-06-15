import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import SuperJSON from 'superjson';

import { routeTree } from './routeTree.gen';

/**
 * Router factory. A router-level QueryClient is created and wired into the
 * TanStack Start SSR query integration so server-rendered query state hydrates
 * on the client (kept intentionally — the app is SSR, not client-only). Feature
 * data still flows through each feature's own `TRPCReactProvider` (mounted in
 * `__root`), exactly as in the Next.js app; those providers nest their own
 * QueryClient for component-level `useTRPC` hooks.
 */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      dehydrate: { serializeData: SuperJSON.serialize },
      hydrate: { deserializeData: SuperJSON.deserialize },
    },
  });

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
