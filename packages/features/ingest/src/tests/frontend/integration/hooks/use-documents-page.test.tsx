/**
 * useDocumentsPage — integration/hooks.
 *
 * The documents page's contract, driven directly: three queries compose into
 * rail rows, a derived selection, the two scoped lists and the advisory
 * headroom. Real hooks, a real QueryClient, MSW at the HTTP boundary — assert
 * returned state, never mock calls.
 *
 * What makes this worth a hook suite of its own rather than leaving it to the
 * page test: the derivations have cases the rendered page cannot reach. The
 * count roll-up spans Sources; headroom is `undefined` while the caps query is
 * in flight; and the derived selection's whole point is what happens when the
 * requested Source stops existing — which a page test can only produce by
 * deleting one.
 *
 * `IngestUploadProvider` is mounted around each render because the hook reads
 * the shared upload state for the in-flight destinations. Its SSE tail can't
 * connect in jsdom, so the progress snapshot is stubbed and the transport is
 * left to fail quietly, exactly as the page test does.
 */
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { IngestUploadProvider } from '../../../../hooks/ingest-upload-context';
import { useDocumentsPage } from '../../../../hooks/use-documents-page';
import { Providers, trpcMsw } from '../../setup';

const WORK = '11111111-1111-4111-8111-111111111111';
const TAX = '22222222-2222-4222-8222-222222222222';
const EMPTY = '33333333-3333-4333-8333-333333333333';

const source = (id: string, name: string) => ({
  id,
  ownerId: 'user-1',
  name,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const doc = (
  dataSourceId: string,
  dataSourceName: string,
  filename: string,
) => ({
  dataSourceId,
  dataSourceName,
  filename,
  count: 3,
  uploadTimestamp: 1,
});

const THREE_SOURCES = [
  source(WORK, 'Work notes'),
  source(TAX, 'Tax'),
  source(EMPTY, 'Recipes'),
];

const server = setupServer(
  trpcMsw.documents.progressSnapshot.query(() => ({
    uploads: [],
    lastId: '0-0',
  })),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const Wrapper = ({ children }: { children: ReactNode }) => (
  <Providers>
    <IngestUploadProvider>{children}</IngestUploadProvider>
  </Providers>
);

const renderPageHook = () =>
  renderHook(() => useDocumentsPage(), { wrapper: Wrapper });

const withCaps = ({
  maxDataSourcesPerUser = 10,
  maxDocumentsPerDataSource = 50,
} = {}) =>
  trpcMsw.dataSources.limits.query(() => ({
    maxDataSourcesPerUser,
    maxDocumentsPerDataSource,
  }));

describe('useDocumentsPage', () => {
  it('rolls the Document counts up onto the rail rows', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => [
        doc(WORK, 'Work notes', 'a.pdf'),
        doc(WORK, 'Work notes', 'b.pdf'),
        doc(TAX, 'Tax', 'return.pdf'),
      ]),
      withCaps(),
    );

    const { result } = renderPageHook();

    await waitFor(() => expect(result.current.sources).toHaveLength(3));
    // One `documents.list` read feeds every row, so the rail costs no query
    // per Source.
    expect(
      result.current.sources.map((s) => [s.name, s.documentCount]),
    ).toEqual([
      ['Work notes', 2],
      ['Tax', 1],
      ['Recipes', 0],
    ]);
    expect(result.current.totalDocumentCount).toBe(3);
  });

  it('opens on the roll-up, where every Document is in view', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => [
        doc(WORK, 'Work notes', 'a.pdf'),
        doc(TAX, 'Tax', 'return.pdf'),
      ]),
      withCaps(),
    );

    const { result } = renderPageHook();

    await waitFor(() => expect(result.current.documentsInView).toHaveLength(2));
    expect(result.current.selected).toBeNull();
  });

  it('narrows the Documents in view to the selected Source', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => [
        doc(WORK, 'Work notes', 'a.pdf'),
        doc(TAX, 'Tax', 'return.pdf'),
      ]),
      withCaps(),
    );

    const { result } = renderPageHook();
    await waitFor(() => expect(result.current.sources).toHaveLength(3));

    act(() => result.current.select(WORK));

    expect(result.current.selected?.name).toBe('Work notes');
    expect(result.current.documentsInView.map((d) => d.filename)).toEqual([
      'a.pdf',
    ]);
  });

  it('DERIVES the selection, so a Source that stops existing lands you on the roll-up', async () => {
    // The stored id is a request; the answer is whether a Source of that id is
    // still there. A `useEffect` clearing the dangling id would paint one frame
    // of a Source that is gone.
    let listCalls = 0;
    server.use(
      trpcMsw.dataSources.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? THREE_SOURCES : THREE_SOURCES.slice(1);
      }),
      trpcMsw.documents.list.query(() => []),
      trpcMsw.dataSources.delete.mutation(() => ({
        id: WORK,
        deletedChunkCount: 6,
      })),
      withCaps(),
    );

    const { result } = renderPageHook();
    await waitFor(() => expect(result.current.sources).toHaveLength(3));

    act(() => result.current.select(WORK));
    expect(result.current.selected?.id).toBe(WORK);

    act(() => result.current.deleteDataSource(WORK));

    // The selection follows the list, not the click: once the refetch comes
    // back without WORK in it, there is nothing to reconcile.
    await waitFor(() => expect(result.current.sources).toHaveLength(2));
    expect(result.current.selected).toBeNull();
  });

  it('is at the Source cap only once the cap is known', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => []),
      trpcMsw.dataSources.limits.query(
        () =>
          new Promise<never>(() => {
            // never resolves — the caps stay in flight
          }),
      ),
    );

    const { result } = renderPageHook();
    await waitFor(() => expect(result.current.sources).toHaveLength(3));

    // An advisory check that guesses is worse than one that waits: with three
    // Sources and no known ceiling, create stays live.
    expect(result.current.maxDataSourcesPerUser).toBeUndefined();
    expect(result.current.atDataSourceCap).toBe(false);
    expect(result.current.headroom(WORK)).toBeUndefined();
  });

  it('is at the Source cap when the list has reached it', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => []),
      withCaps({ maxDataSourcesPerUser: 3 }),
    );

    const { result } = renderPageHook();

    await waitFor(() => expect(result.current.atDataSourceCap).toBe(true));
  });

  it('counts headroom against the Documents a Source already holds', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => [
        doc(WORK, 'Work notes', 'a.pdf'),
        doc(WORK, 'Work notes', 'b.pdf'),
      ]),
      withCaps({ maxDocumentsPerDataSource: 5 }),
    );

    const { result } = renderPageHook();
    await waitFor(() =>
      expect(result.current.maxDocumentsPerDataSource).toBe(5),
    );

    expect(result.current.headroom(WORK)).toBe(3);
    // An empty Source has its whole cap free.
    expect(result.current.headroom(EMPTY)).toBe(5);
  });

  it('has no Uploads in view from the roll-up, because progress belongs to its destination', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => []),
      withCaps(),
    );

    const { result } = renderPageHook();
    await waitFor(() => expect(result.current.sources).toHaveLength(3));

    expect(result.current.uploadsInView).toEqual([]);
    expect(result.current.uploadsSummary.total).toBe(0);
    // Nothing in flight, so no row spins either.
    expect(result.current.sources.every((s) => !s.hasUploadInFlight)).toBe(
      true,
    );
  });
});
