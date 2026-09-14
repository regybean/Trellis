/**
 * The shared persisted-query options against a **paginated** query
 * ([ADR 0001](../../../../docs/adr/0001-per-query-indexeddb-persister.md)).
 *
 * Two proofs in one file, because they hold each other up:
 *
 * 1. **Type-level.** `persistedOptions` is annotated with the exact return type
 *    of `usePersistedQueryOptions`, then spread into both a plain and an
 *    infinite query below. Nothing in this repository is paginated, so a fix
 *    typed only for the infinite case would otherwise rot unexercised — this
 *    annotation is what `pnpm typecheck` gates, and it fails the moment the
 *    persister stops fitting an infinite query's `persister` slot.
 * 2. **Runtime.** The same options drive a real `fetchInfiniteQuery` against
 *    `fake-indexeddb`, so the pages are proven to reach storage and come back
 *    on a cold open — not merely to compile.
 *
 * Asserts external behaviour only: restored data and which keys land in
 * storage. No mocks — real QueryClient, real (fake) IndexedDB.
 */
import type { AnyRouter } from '@trpc/server';
import {
  hashKey,
  infiniteQueryOptions,
  QueryClient,
  queryOptions,
} from '@tanstack/react-query';
import { createStore, keys } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';

import type { createFeatureClient } from '../../../create-feature-client';
import { createQueryPersister, persistMeta } from '../../../query-persister';

const KEY_PREFIX = 'paged';
const APP_VERSION = 'v1';

/** Same store handle the persister writes under: `rq-<keyPrefix>`. */
const inspectStore = () => createStore(`rq-${KEY_PREFIX}`, 'cache');

const storageKeyFor = (queryKey: unknown[]) =>
  `tanstack-query-${hashKey(queryKey)}`;

/**
 * What a feature actually spreads into a persisted query — pinned to the type
 * `usePersistedQueryOptions` returns, so this file cannot drift into proving
 * something narrower than what features consume.
 */
type PersistedQueryOptions = ReturnType<
  ReturnType<typeof createFeatureClient<AnyRouter>>['usePersistedQueryOptions']
>;

/** The persister branch of {@link PersistedQueryOptions}. */
const persistedOptions = (scopeKey: string): PersistedQueryOptions => ({
  meta: persistMeta,
  staleTime: 0,
  persister: createQueryPersister({
    keyPrefix: KEY_PREFIX,
    scopeKey,
    appVersion: APP_VERSION,
  }),
  gcTime: Infinity,
});

/**
 * The no-persister branch — a feature that never opted in, an app that supplied
 * no `scopeKey`, or a browser without IndexedDB.
 */
const networkOnlyOptions = (): PersistedQueryOptions => ({
  meta: persistMeta,
  staleTime: 0,
});

interface Page {
  items: readonly string[];
  next: number | null;
}

const pages: readonly Page[] = [
  { items: ['a', 'b'], next: 1 },
  { items: ['c'], next: null },
];

const pageAt = (pageParam: number) =>
  pages[pageParam] ?? { items: [], next: null };

/**
 * A paginated query, spreading the shared options — the case that could not be
 * typed before. No assertion at this call site is the point of the ticket.
 */
const documentsOptions = (persisted: PersistedQueryOptions) =>
  infiniteQueryOptions({
    queryKey: ['documents'],
    queryFn: ({ pageParam }) => Promise.resolve(pageAt(pageParam)),
    initialPageParam: 0,
    getNextPageParam: (lastPage: Page) => lastPage.next,
    ...persisted,
  });

/** The non-paginated case, unchanged — the same options still fit it. */
const greetingOptions = (persisted: PersistedQueryOptions) =>
  queryOptions({
    queryKey: ['greeting'],
    queryFn: () => Promise.resolve('hello'),
    ...persisted,
  });

describe('the shared persisted-query options on a paginated query', () => {
  it('persists fetched pages and restores them for a fresh client offline', async () => {
    const writer = new QueryClient();
    const fetched = await writer.fetchInfiniteQuery(
      documentsOptions(persistedOptions('user-1')),
    );

    expect(fetched.pages).toEqual([pages[0]]);
    await vi.waitFor(async () =>
      expect(await keys(inspectStore())).toContain(
        storageKeyFor(['documents']),
      ),
    );

    // Fresh client, same scope, and a query function that rejects — a pass
    // proves the pages came back out of IndexedDB rather than the network.
    const reader = new QueryClient();
    const restored = await reader.fetchInfiniteQuery({
      ...documentsOptions(persistedOptions('user-1')),
      queryFn: () => Promise.reject(new Error('network must not be hit')),
      retry: false,
    });

    expect(restored.pages).toEqual([pages[0]]);
    expect(restored.pageParams).toEqual([0]);
  });

  it('keeps paging after a restore, and persists the pages it adds', async () => {
    const client = new QueryClient();
    const options = documentsOptions(persistedOptions('user-1'));

    await client.fetchInfiniteQuery(options);
    const bothPages = await client.fetchInfiniteQuery({ ...options, pages: 2 });

    expect(bothPages.pages).toEqual(pages);

    // The store is written asynchronously, so retry a cold open until it holds
    // both pages — the page params have to survive alongside the data, or the
    // restored list cannot page on.
    const restored = await vi.waitFor(async () => {
      const reader = new QueryClient();
      const result = await reader.fetchInfiniteQuery({
        ...options,
        queryFn: () => Promise.reject(new Error('network must not be hit')),
        retry: false,
      });
      expect(result.pages).toEqual(pages);
      return result;
    });

    expect(restored.pageParams).toEqual([0, 1]);
  });

  it('scopes pages per user — another scopeKey never rehydrates them', async () => {
    const owner = new QueryClient();
    await owner.fetchInfiniteQuery(
      documentsOptions(persistedOptions('user-1')),
    );
    await vi.waitFor(async () =>
      expect(await keys(inspectStore())).toContain(
        storageKeyFor(['documents']),
      ),
    );

    const other = new QueryClient();
    await expect(
      other.fetchInfiniteQuery({
        ...documentsOptions(persistedOptions('user-2')),
        queryFn: () => Promise.reject(new Error('cache miss — fetched')),
        retry: false,
      }),
    ).rejects.toThrow('cache miss — fetched');
  });

  it('degrades to network-only when the feature has no persister', async () => {
    const client = new QueryClient();
    const fetched = await client.fetchInfiniteQuery(
      documentsOptions(networkOnlyOptions()),
    );

    expect(fetched.pages).toEqual([pages[0]]);
    expect(await keys(inspectStore())).toHaveLength(0);
  });

  it('leaves a non-paginated query on the same options behaving as before', async () => {
    const writer = new QueryClient();
    await writer.fetchQuery(greetingOptions(persistedOptions('user-1')));

    await vi.waitFor(async () =>
      expect(await keys(inspectStore())).toContain(storageKeyFor(['greeting'])),
    );

    const reader = new QueryClient();
    const restored = await reader.fetchQuery({
      ...greetingOptions(persistedOptions('user-1')),
      queryFn: () => Promise.reject(new Error('network must not be hit')),
      retry: false,
    });

    expect(restored).toBe('hello');
  });
});
