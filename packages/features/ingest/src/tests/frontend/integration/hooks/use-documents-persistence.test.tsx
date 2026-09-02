/**
 * Offline read of the Documents pane (#216, ADR 0025).
 *
 * The behaviour under test at the rendered-DOM seam (ADR 0018): `documents.list`
 * paints from IndexedDB on a cold `QueryClient` instead of the "Loading
 * documents…" skeleton. Ingest's client revalidates on every mount
 * (`staleTime: 0` — the lever that makes the persister's post-restore refetch
 * fire; `refetchOnMount` does NOT, see query-client.ts), so the guarantee is
 * stale-while-revalidate: the restored snapshot renders instantly AND a failed
 * background revalidation must never blank it (nor throw an unhandled rejection
 * — the persister is patched to `.catch()` it, and vitest fails the run if that
 * patch stops applying to ingest's usage).
 *
 * Each case primes the cache with the network available, then mounts a fresh
 * client. Two stand-ins for "no server truth" are used deliberately: `offline`
 * (the fetch throws) proves a restored snapshot survives a *failed*
 * revalidation; `neverResolves` proves the opposite direction — that with
 * nothing to rehydrate the pane sits on its skeleton, so a filename appearing
 * could only have come from storage. Asserts what renders; no mock call counts,
 * no persister internals.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { createStore, keys } from 'idb-keyval';
import { delay } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { DocumentFilenameSummary } from '@acme/rag/server';

import { DocumentsList } from '../../../../components/documents-list';
import { clearIngestPersistedCache } from '../../../../trpc/react';
import { ScopedProviders, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Ingest's own IndexedDB store — `rq-ingest`, keyed off its `keyPrefix`.
const ingestStore = () => createStore('rq-ingest', 'cache');
const persisted = async () => keys(ingestStore());
const SCOPE = 'user-1';

const doc = (filename: string, count: number): DocumentFilenameSummary => ({
  filename,
  count,
  uploadTimestamp: Date.UTC(2020, 0, 1),
});

// Stand-in for offline / an unreachable endpoint: the mount revalidation fetch
// (`staleTime: 0`) errors, and the restored cache must survive it.
const offline = () => {
  throw new Error('documents.list unreachable — offline');
};

// Stand-in for a server that never answers: the pane holds its skeleton, so
// anything that *does* render came from the persisted snapshot.
const neverResolves = async (): Promise<DocumentFilenameSummary[]> => {
  await delay('infinite');
  return [];
};

/**
 * Render `DocumentsList` under the persister for `scopeKey`, wait for the given
 * filename to paint, then wait for the async IndexedDB write to flush and
 * unmount — leaving a primed `rq-ingest` store for a cold open.
 */
async function primeCache(filename: string, scopeKey = SCOPE) {
  const warm = render(<DocumentsList />, {
    wrapper: ScopedProviders(scopeKey),
  });
  await screen.findByText(filename);
  await waitFor(async () => expect(await persisted()).not.toHaveLength(0));
  warm.unmount();
}

describe('ingest offline read — the Documents pane (documents.list)', () => {
  it('paints the persisted Documents on a cold open with no network', async () => {
    server.use(trpcMsw.documents.list.query(() => [doc('handbook.pdf', 12)]));
    await primeCache('handbook.pdf');

    // Cold open, offline: the mount revalidation errors, so a rendered list
    // proves the persisted snapshot paints and survives the failed refetch.
    server.resetHandlers(trpcMsw.documents.list.query(offline));
    render(<DocumentsList />, { wrapper: ScopedProviders(SCOPE) });

    expect(await screen.findByText('handbook.pdf')).toBeInTheDocument();
    expect(await screen.findByText('12 chunks')).toBeInTheDocument();
    expect(screen.queryByText('Loading documents…')).not.toBeInTheDocument();
  });

  it('revalidates a seconds-old snapshot so a just-uploaded Document appears', async () => {
    // The regression `staleTime: 0` exists for: upload a Document, reload
    // immediately, and the persisted (pre-upload) list is younger than any
    // non-zero staleTime — served without revalidating. The persister IS the
    // queryFn on a cold open and only schedules its background refetch
    // `if (query.isStale())`, so with the old 30s staleTime this never fired.
    server.use(trpcMsw.documents.list.query(() => [doc('handbook.pdf', 12)]));
    await primeCache('handbook.pdf');

    // Cold open moments later, server now also has the just-uploaded file.
    server.resetHandlers(
      trpcMsw.documents.list.query(() => [
        doc('handbook.pdf', 12),
        doc('just-uploaded.pdf', 3),
      ]),
    );
    render(<DocumentsList />, { wrapper: ScopedProviders(SCOPE) });

    // The snapshot paints first, then the revalidation lands.
    expect(await screen.findByText('handbook.pdf')).toBeInTheDocument();
    expect(await screen.findByText('just-uploaded.pdf')).toBeInTheDocument();
  });
});

describe('ingest offline read — scoping and clearing', () => {
  it('never rehydrates another user’s Documents (scopeKey buster)', async () => {
    server.use(trpcMsw.documents.list.query(() => [doc('private.pdf', 7)]));
    await primeCache('private.pdf', 'user-1');

    // A second principal on the same browser: `buster` is
    // `INGEST_PERSIST_VERSION:scopeKey`, so user-1's entry is discarded on
    // restore. With the server never answering, the pane can only hold its
    // skeleton — user-1's file appearing would mean it rehydrated.
    server.resetHandlers(trpcMsw.documents.list.query(neverResolves));
    render(<DocumentsList />, { wrapper: ScopedProviders('user-2') });

    expect(await screen.findByText('Loading documents…')).toBeInTheDocument();
    expect(screen.queryByText('private.pdf')).not.toBeInTheDocument();
  });

  it('empties the rq-ingest store on the logout path', async () => {
    server.use(trpcMsw.documents.list.query(() => [doc('handbook.pdf', 12)]));
    await primeCache('handbook.pdf');

    // What the full apps call alongside `queryClient.clear()` on logout.
    await clearIngestPersistedCache();
    expect(await persisted()).toHaveLength(0);

    // The departing user's Documents are gone, not merely out of scope: a cold
    // open on the SAME scope has nothing left to restore.
    server.resetHandlers(trpcMsw.documents.list.query(neverResolves));
    render(<DocumentsList />, { wrapper: ScopedProviders(SCOPE) });

    expect(await screen.findByText('Loading documents…')).toBeInTheDocument();
    expect(screen.queryByText('handbook.pdf')).not.toBeInTheDocument();
  });
});
