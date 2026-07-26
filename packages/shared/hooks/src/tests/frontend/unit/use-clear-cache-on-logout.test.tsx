/**
 * useClearCacheOnLogout — the logout-clear seam the full apps wire (#86, ADR
 * 0025). Asserts observable *state*, never call counts (ADR 0018): after a
 * signed-in → signed-out transition the enclosing QueryClient's cache is empty
 * and the injected store (a real `clearPersistedCache` over fake-indexeddb) is
 * wiped; neither clears on a signed-out mount or a sign-in. No mocks — real
 * QueryClient, real (fake) IndexedDB.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createStore, keys, set } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';

import { clearPersistedCache } from '../../../query-persister';
import { useClearCacheOnLogout } from '../../../use-clear-cache-on-logout';

const KEY_PREFIX = 'logout-test';
// Same store handle `clearPersistedCache` empties: `rq-<keyPrefix>`.
const featureStore = () => createStore(`rq-${KEY_PREFIX}`, 'cache');
const clearStore = () => clearPersistedCache(KEY_PREFIX);

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

/** A QueryClient + persisted store both holding one entry. */
const seed = async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['greeting'], 'hello');
  await set('entry', 'hello', featureStore());
  return queryClient;
};

describe('useClearCacheOnLogout', () => {
  it('empties the query cache + persisted store when signed-in → signed-out', async () => {
    const queryClient = await seed();

    const { rerender } = renderHook(
      ({ isSignedIn }) => useClearCacheOnLogout(isSignedIn, clearStore),
      { wrapper: wrapperFor(queryClient), initialProps: { isSignedIn: true } },
    );

    // Still signed in — nothing cleared.
    expect(queryClient.getQueryCache().getAll()).not.toHaveLength(0);
    expect(await keys(featureStore())).not.toHaveLength(0);

    rerender({ isSignedIn: false });

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    await vi.waitFor(async () =>
      expect(await keys(featureStore())).toHaveLength(0),
    );
  });

  it('leaves caches intact on a signed-out mount (no prior session)', async () => {
    const queryClient = await seed();

    renderHook(() => useClearCacheOnLogout(false, clearStore), {
      wrapper: wrapperFor(queryClient),
    });

    expect(queryClient.getQueryCache().getAll()).not.toHaveLength(0);
    expect(await keys(featureStore())).not.toHaveLength(0);
  });

  it('leaves caches intact on sign-in', async () => {
    const queryClient = await seed();

    const { rerender } = renderHook(
      ({ isSignedIn }) => useClearCacheOnLogout(isSignedIn, clearStore),
      { wrapper: wrapperFor(queryClient), initialProps: { isSignedIn: false } },
    );

    rerender({ isSignedIn: true });

    expect(queryClient.getQueryCache().getAll()).not.toHaveLength(0);
    expect(await keys(featureStore())).not.toHaveLength(0);
  });
});
