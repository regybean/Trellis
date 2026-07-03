/**
 * DocumentsList — integration/components (ADR 0018).
 *
 * The reference rewrite: the old test `vi.mock`ed `../../trpc/react` and
 * asserted `deleteSpy.toHaveBeenCalledWith(...)`. This one fakes the network at
 * the HTTP boundary with MSW, runs the real `useDocuments` hook + QueryClient,
 * and asserts the observable outcome — the row leaving the DOM and the success
 * toast rendering — never a mock call.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '@testing-library/jest-dom';

import { DocumentsList } from '../../../../components/documents-list';
import { renderWithProviders, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const doc = (filename: string, count: number, uploadTimestamp = 1) => ({
  filename,
  count,
  uploadTimestamp,
});

describe('DocumentsList', () => {
  it('shows a loading state while the query is pending', () => {
    server.use(
      trpcMsw.documents.list.query(
        () =>
          new Promise<never>(() => {
            // never resolves — keeps the query pending so we can assert loading
          }),
      ),
    );

    renderWithProviders(<DocumentsList />);

    expect(screen.getByText(/loading documents/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no documents', async () => {
    server.use(trpcMsw.documents.list.query(() => []));

    renderWithProviders(<DocumentsList />);

    expect(
      await screen.findByText(/no documents uploaded yet/i),
    ).toBeInTheDocument();
  });

  it('renders each document with its chunk count', async () => {
    server.use(
      trpcMsw.documents.list.query(() => [doc('a.pdf', 3), doc('b.txt', 1, 2)]),
    );

    renderWithProviders(<DocumentsList />);

    expect(await screen.findByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('3 chunks')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(screen.getByText('1 chunks')).toBeInTheDocument();
  });

  it('deletes a document: removes its row and toasts success', async () => {
    let listCalls = 0;
    server.use(
      // First load has the doc; after the delete invalidates the list, the
      // refetch returns empty — so the row leaving the DOM is the outcome.
      trpcMsw.documents.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? [doc('a.pdf', 3)] : [];
      }),
      trpcMsw.documents.delete.mutation(() => ({
        deletedCount: 3,
        filename: 'a.pdf',
      })),
    );

    const user = userEvent.setup();
    renderWithProviders(<DocumentsList />);

    await user.click(
      await screen.findByRole('button', { name: /delete a\.pdf/i }),
    );

    expect(await screen.findByText('Document deleted')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('a.pdf')).not.toBeInTheDocument(),
    );
  });
});
