/**
 * query-persister — the one new seam this ticket adds (#83, ADR 0025).
 *
 * Exercised at the QueryClient + persister level against `fake-indexeddb` (the
 * setup swaps a fresh IndexedDB in per test). Asserts external behaviour only —
 * what a caller observes (restored data, which keys land in storage) — never
 * the persister's internal methods. No mocks: real QueryClient, real (fake)
 * IndexedDB.
 */
import { hashKey, QueryClient } from '@tanstack/react-query';
import { createStore, keys } from 'idb-keyval';
import { describe, expect, it, vi } from 'vitest';

import {
  clearPersistedCache,
  createQueryPersister,
  persistMeta,
} from '../../../query-persister';

const KEY_PREFIX = 'test';
const APP_VERSION = 'v1';

// Same store handle the persister writes under: `rq-<keyPrefix>`.
const inspectStore = () => createStore(`rq-${KEY_PREFIX}`, 'cache');

/** A QueryClient wired to a persister for the given scope. */
const clientForScope = (scopeKey: string) =>
  new QueryClient({
    defaultOptions: {
      queries: {
        persister: createQueryPersister({
          keyPrefix: KEY_PREFIX,
          scopeKey,
          appVersion: APP_VERSION,
        }),
        // Restored data is never treated as stale, so a restore doesn't trigger
        // a background refetch in these no-network tests.
        staleTime: Infinity,
        gcTime: Infinity,
        // Fail fast when a query is expected to hit the (throwing) network.
        retry: false,
      },
    },
  });

const storageKeyFor = (queryKey: unknown[]) =>
  `tanstack-query-${hashKey(queryKey)}`;

describe('createQueryPersister', () => {
  it('round-trips: data one client persists is restored by a fresh client offline', async () => {
    const queryKey = ['greeting'];
    // A Date proves identity serialize + IndexedDB structured clone (no JSON).
    const value = { msg: 'hello', at: new Date('2020-01-01T00:00:00.000Z') };

    const writer = clientForScope('user-1');
    const original = await writer.fetchQuery({
      queryKey,
      queryFn: () => Promise.resolve(value),
      meta: persistMeta,
    });

    await vi.waitFor(async () =>
      expect(await keys(inspectStore())).toContain(storageKeyFor(queryKey)),
    );

    // Fresh client, same scope — network throws, so a pass proves the read came
    // from IndexedDB.
    const reader = clientForScope('user-1');
    const restored = await reader.fetchQuery<typeof value>({
      queryKey,
      queryFn: () => Promise.reject(new Error('network must not be hit')),
      meta: persistMeta,
    });

    expect(restored).toEqual(original);
    expect(restored.at).toBeInstanceOf(Date);
  });

  it('persists only queries marked with persistMeta', async () => {
    const client = clientForScope('user-1');

    await client.fetchQuery({
      queryKey: ['marked'],
      queryFn: () => Promise.resolve('kept'),
      meta: persistMeta,
    });
    await client.fetchQuery({
      queryKey: ['unmarked'],
      queryFn: () => Promise.resolve('dropped'),
    });

    await vi.waitFor(async () =>
      expect(await keys(inspectStore())).toContain(storageKeyFor(['marked'])),
    );

    const stored = await keys(inspectStore());
    expect(stored).toContain(storageKeyFor(['marked']));
    expect(stored).not.toContain(storageKeyFor(['unmarked']));
  });

  it('discards the cache when the scopeKey changes (buster mismatch)', async () => {
    const queryKey = ['secret'];

    const owner = clientForScope('user-1');
    await owner.fetchQuery({
      queryKey,
      queryFn: () => Promise.resolve('user-1 data'),
      meta: persistMeta,
    });
    await vi.waitFor(async () =>
      expect(await keys(inspectStore())).toContain(storageKeyFor(queryKey)),
    );

    // A different user must not rehydrate the previous user's snapshot: the
    // buster (appVersion:scopeKey) no longer matches, so the entry is discarded
    // and the (throwing) network is reached.
    const other = clientForScope('user-2');
    await expect(
      other.fetchQuery({
        queryKey,
        queryFn: () => Promise.reject(new Error('cache miss — fetched')),
        meta: persistMeta,
      }),
    ).rejects.toThrow('cache miss — fetched');
  });

  it('clearPersistedCache empties the feature store', async () => {
    const client = clientForScope('user-1');
    await client.fetchQuery({
      queryKey: ['greeting'],
      queryFn: () => Promise.resolve('hello'),
      meta: persistMeta,
    });
    await vi.waitFor(async () =>
      expect(await keys(inspectStore())).not.toHaveLength(0),
    );

    await clearPersistedCache(KEY_PREFIX);

    expect(await keys(inspectStore())).toHaveLength(0);
  });
});
