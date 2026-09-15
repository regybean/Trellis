/**
 * useOptimisticMutationOptions — integration/hooks.
 *
 * Drives the real fragment through a real `QueryClient` and a real
 * `<ToastContainer />`, asserting cache contents and rendered DOM. This package
 * owns no router to fake at the HTTP boundary, so the query and the mutation
 * are plain promise-returning functions standing in for a server — the seam
 * under test is the cache protocol, not a transport. Nothing is mocked: no
 * `vi.fn`, no call-count assertions.
 *
 * The third case is the one the fragment exists for. Snapshotting before an
 * in-flight refetch has been cancelled captures a half-landed server response
 * as the rollback value, and nothing about getting that wrong fails loudly — so
 * it is asserted here once, rather than trusted at every call site.
 */
import type { ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { ToastContainer } from 'react-toastify';
import { describe, expect, it } from 'vitest';

import { useOptimisticMutationOptions } from '../../../../use-optimistic-mutation-options';

/** The generic error handler's non-rate-limited message, as it renders. */
const ERROR_TOAST = 'Service currently unavailable. Please try again later.';

const ITEMS_KEY = ['items'];

/** A fetch that stays in flight for the rest of the test. */
const staysInFlight = () =>
  new Promise<string[]>(() => {
    // Never settles: whatever the cache holds is what the protocol put there.
  });

/** A save that fails, late enough that the optimistic window is observable. */
const failsToSave = () =>
  new Promise<string>((_resolve, reject) => {
    setTimeout(() => reject(new Error('save failed')), 50);
  });

/** A save slow enough that the in-flight window can be asserted in. */
const savesSlowly = (item: string) =>
  new Promise<string>((resolve) => {
    setTimeout(() => resolve(item), 200);
  });

/**
 * Let React and the query cache apply the updates a change made outside a
 * render has queued. A macrotask, not a microtask: TanStack's notifyManager
 * schedules its batches with `setTimeout`, so a microtask flush would return
 * before a settled fetch had written anything.
 */
const flushReact = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      }),
  );

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        <ToastContainer />
      </QueryClientProvider>
    );
  };

/**
 * A caller in the shape every real one takes: a list query, plus one mutation
 * whose entire declaration is its patch (here, append).
 */
const useItems = (
  fetchItems: () => Promise<string[]>,
  saveItem: (item: string) => Promise<string>,
) => {
  const items = queryOptions({ queryKey: ITEMS_KEY, queryFn: fetchItems });
  const listQuery = useQuery(items);
  const addMutation = useMutation({
    mutationFn: saveItem,
    ...useOptimisticMutationOptions(
      items.queryKey,
      (previous, item: string) => [...(previous ?? []), item],
    ),
  });

  return {
    items: listQuery.data,
    add: (item: string) => addMutation.mutate(item),
  };
};

describe('useOptimisticMutationOptions', () => {
  it('shows the patch immediately, then reconciles to one row on settle', async () => {
    // A fake server holding real state. The settle invalidation refetches it,
    // so a client-minted row the server also stores reconciles to ONE row.
    const stored = ['a'];
    const fetchItems = () => Promise.resolve([...stored]);
    const saveItem = (item: string) => {
      stored.push(item);
      return Promise.resolve(item);
    };

    const { result } = renderHook(() => useItems(fetchItems, saveItem), {
      wrapper: wrapperFor(new QueryClient()),
    });
    await waitFor(() => expect(result.current.items).toEqual(['a']));

    act(() => result.current.add('b'));

    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));
    await waitFor(() => expect(stored).toEqual(['a', 'b']));
    // Still one 'b' after the server's own copy has been refetched.
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));
  });

  it('rolls back to the pre-mutation contents and reports the failure', async () => {
    // The settle refetch never lands, so the only thing that can restore the
    // pre-mutation list is the rollback.
    let fetchCount = 0;
    const fetchItems = () => {
      fetchCount += 1;
      return fetchCount === 1 ? Promise.resolve(['a', 'b']) : staysInFlight();
    };

    const { result } = renderHook(() => useItems(fetchItems, failsToSave), {
      wrapper: wrapperFor(new QueryClient()),
    });
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));

    act(() => result.current.add('c'));
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b', 'c']));

    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));
    expect(await screen.findByText(ERROR_TOAST)).toBeDefined();
  });

  it('cancels the refetch in flight, so its late response cannot clobber the patch', async () => {
    let fetchCount = 0;
    let landStaleRefetch: ((items: string[]) => void) | undefined;
    const fetchItems = () => {
      fetchCount += 1;
      if (fetchCount === 1) return Promise.resolve(['a']);
      // The refetch in flight when the mutation starts. Held open so its
      // response can be made to land AFTER the patch has been written.
      if (fetchCount === 2)
        return new Promise<string[]>((resolve) => {
          landStaleRefetch = resolve;
        });
      return Promise.resolve(['a', 'b']);
    };

    const queryClient = new QueryClient();
    const { result } = renderHook(() => useItems(fetchItems, savesSlowly), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(result.current.items).toEqual(['a']));

    // Put a refetch in flight, then mutate while it is still open.
    void queryClient.refetchQueries({ queryKey: ITEMS_KEY }).catch(() => {
      // The mutation cancels it; the rejection is the expected outcome.
    });
    await flushReact();

    act(() => result.current.add('b'));
    await waitFor(() => expect(result.current.items).toEqual(['a', 'b']));

    // The stale fetch resolves while the save is still in flight — before the
    // settle invalidation, which would supersede it anyway. A live fetch writes
    // its body straight over the patch; a cancelled one is discarded.
    landStaleRefetch?.(['stale']);
    await flushReact();

    expect(result.current.items).toEqual(['a', 'b']);
  });
});
