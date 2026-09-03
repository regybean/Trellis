import 'server-only';

import type { TRPCQueryOptions } from '@trpc/tanstack-react-query';
import { cache } from 'react';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';

import type { InjectedSession } from '@acme/trpc';
import { createAppQueryClient } from '@acme/hooks';

import type { AppRouter } from '../api/root';
import { appRouter } from '../api/root';
import { createTRPCContext } from '../api/trpc';

/**
 * Framework-neutral RSC server caller (reference scaffold — no app imports it
 * today). The session seam: the *app* resolves whoever is calling at its
 * boundary and injects the result here. This feature depends on no auth SDK.
 *
 * There is no billing seam to wire, because feedback declares no tRPC context
 * extension: no tier to gate on, no credit to spend, so it names no entitlements
 * provider at all. `@acme/chat`'s equivalent does (#256, ADR 0006 amendment).
 * See docs/adr/0003-framework-agnostic-auth-seam.md.
 */
export interface ServerTRPCOptions {
  headers: Headers;
  session: InjectedSession;
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
