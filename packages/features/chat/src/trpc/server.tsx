import 'server-only';

import type { TRPCQueryOptions } from '@trpc/tanstack-react-query';
import { cache } from 'react';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

import type { EntitlementsProvider, InjectedSession } from '@acme/trpc';
import { createAppQueryClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { appRouter } from '../api/root';
import { createTRPCContext } from '../api/trpc';

/**
 * Framework-neutral RSC server caller (reference scaffold — no app
 * imports it today). The session + billing seams: the
 * *app* resolves whoever is calling and chooses an entitlements provider at its
 * boundary, then injects both here. This feature depends on no auth SDK and no billing provider.
 * An app wires its own context resolver's session and `subscriptionsEntitlements` (or
 * `unlimitedEntitlements` for a no-billing build) into
 * `createServerTRPC`. See docs/adr/0003-framework-agnostic-auth-seam.md and
 * docs/adr/0006-entitlements-injection-seam.md.
 */
export interface ServerTRPCOptions {
  headers: Headers;
  session: InjectedSession;
  entitlements: EntitlementsProvider;
}

// The RSC half's own client — a fresh one per request, from the same factory the
// app mounts in the browser (ADR 0036). Not the app's client: an RSC render has
// no React context to read one from, and its cache is dehydrated into the
// response rather than shared.
const getQueryClient = cache(createAppQueryClient);

export function createServerTRPC(opts: ServerTRPCOptions) {
  const createContext = cache(async () => {
    const heads = new Headers(opts.headers);
    heads.set('x-trpc-source', 'rsc');

    return createTRPCContext({
      headers: heads,
      session: opts.session,
      entitlements: opts.entitlements,
    });
  });

  return createTRPCOptionsProxy<AppRouter>({
    router: appRouter,
    ctx: createContext,
    queryClient: getQueryClient,
  });
}

export function HydrateClient(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {props.children}
    </HydrationBoundary>
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(
  queryOptions: T,
) {
  const queryClient = getQueryClient();
  if (queryOptions.queryKey[1]?.type === 'infinite') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    void queryClient.prefetchInfiniteQuery(queryOptions as any);
  } else {
    void queryClient.prefetchQuery(queryOptions);
  }
}
