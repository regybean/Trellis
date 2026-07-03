/**
 * useDocuments — integration/hooks (ADR 0018).
 *
 * Drive the real hook through a real QueryClient with MSW at the HTTP boundary.
 * Assert returned state and cache transitions — never mock-call counts.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useDocuments } from '../../../../hooks/use-documents';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const doc = (filename: string, count = 3, uploadTimestamp = 1) => ({
  filename,
  count,
  uploadTimestamp,
});

const renderUseDocuments = () =>
  renderHook(() => useDocuments(), { wrapper: Providers });

describe('useDocuments', () => {
  it('is loading while the list query is pending', () => {
    server.use(
      trpcMsw.documents.list.query(
        () =>
          new Promise<never>(() => {
            // never resolves
          }),
      ),
    );

    const { result } = renderUseDocuments();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.documents).toEqual([]);
  });

  it('returns an empty array when no documents are indexed', async () => {
    server.use(trpcMsw.documents.list.query(() => []));

    const { result } = renderUseDocuments();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.documents).toEqual([]);
  });

  it('returns the document list from the server', async () => {
    server.use(
      trpcMsw.documents.list.query(() => [doc('a.pdf', 3), doc('b.txt', 1, 2)]),
    );

    const { result } = renderUseDocuments();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.documents).toHaveLength(2);
    expect(result.current.documents[0]?.filename).toBe('a.pdf');
    expect(result.current.documents[1]?.filename).toBe('b.txt');
  });

  it('removes the deleted document from the list after deletion', async () => {
    let listCalls = 0;
    server.use(
      trpcMsw.documents.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? [doc('a.pdf')] : [];
      }),
      trpcMsw.documents.delete.mutation(() => ({
        deletedCount: 3,
        filename: 'a.pdf',
      })),
    );

    const { result } = renderUseDocuments();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.documents).toHaveLength(1);

    act(() => result.current.deleteDocument('a.pdf'));

    await waitFor(() => expect(result.current.documents).toHaveLength(0));
  });

  it('is deleting while the delete mutation is in-flight', async () => {
    const deleteResponse = { deletedCount: 3, filename: 'a.pdf' };
    let resolveDelete!: (v: typeof deleteResponse) => void;

    server.use(
      trpcMsw.documents.list.query(() => [doc('a.pdf')]),
      trpcMsw.documents.delete.mutation(
        () =>
          new Promise<typeof deleteResponse>((resolve) => {
            resolveDelete = resolve;
          }),
      ),
    );

    const { result } = renderUseDocuments();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.deleteDocument('a.pdf'));

    await waitFor(() => expect(result.current.isDeleting).toBe(true));

    act(() => resolveDelete(deleteResponse));
    await waitFor(() => expect(result.current.isDeleting).toBe(false));
  });
});
