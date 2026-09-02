'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  defaultShouldDehydrateQuery,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import SuperJSON from 'superjson';

// The app's single `QueryClient` (ADR 0036). Every feature's queries live in it,
// namespaced by tRPC's `keyPrefix`, so `useQuery` has exactly one client to
// resolve to and a hook can never bind to the wrong one (#82). Feature-specific
// cache policy — persister, `gcTime`, `staleTime` — is declared per query
// (`usePersistedQueryOptions`), not here: this client is deliberately ignorant of
// which features an app mounts.

/**
 * Build an app's `QueryClient`. The only defaults it carries are transport-level
 * and true for every feature:
 *
 * - **SuperJSON `dehydrate`/`hydrate`.** Feature payloads cross the wire through
 *   SuperJSON (`Date`s in Messages and Documents), so an SSR dehydrate has to use
 *   the same transformer or those values flatten on the way back.
 * - **`shouldDehydrateQuery` widened to `pending`.** Streamed SSR ships a query
 *   that hasn't settled yet and lets the client await it.
 *
 * No `staleTime`: react-query's default of `0` is the honest one here. A non-zero
 * app default would silently break every persisted query (ADR 0025 — the
 * persister only revalidates `if (query.isStale())`), and the queries that want a
 * longer window are better off saying so at the call site.
 */
export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === 'pending',
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });

/**
 * Mount the app's `QueryClient`. For apps whose framework gives them no other
 * place to own one — the Next.js apps mount this at the root of `layout.tsx`,
 * above every feature provider. The TanStack apps do NOT use it: their router
 * already owns a client so it can be handed to `setupRouterSsrQueryIntegration`,
 * and they call {@link createAppQueryClient} directly in `router.tsx`.
 *
 * `useState` rather than a module singleton: one client per mounted tree. On the
 * server that means a fresh cache per request (no cross-request leakage); in the
 * browser the root layout mounts once, so it is the same client for the life of
 * the document.
 */
export function AppQueryClientProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createAppQueryClient);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
