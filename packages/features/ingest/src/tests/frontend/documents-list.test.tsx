import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentsList } from '../../components/documents-list';
import { renderWithProviders } from './setup';

// Spies the mocked tRPC hooks delegate to.
const listQueryFn = vi.fn();
const deleteSpy = vi.fn();

vi.mock('../../trpc/react', () => ({
  useTRPC: () => ({
    documents: {
      list: {
        queryOptions: () => ({
          queryKey: ['documents', 'list'],
          queryFn: listQueryFn,
        }),
        pathFilter: () => ({ queryKey: ['documents', 'list'] }),
      },
      delete: {
        mutationOptions: (opts?: {
          onSuccess?: () => void;
          onError?: () => void;
        }) => ({ mutationFn: deleteSpy, ...opts }),
      },
    },
  }),
}));

describe('DocumentsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading state while the query is pending', () => {
    listQueryFn.mockReturnValue(new Promise(() => undefined)); // never resolves

    renderWithProviders(<DocumentsList />);

    expect(screen.getByText(/loading documents/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no documents', async () => {
    listQueryFn.mockResolvedValue([]);

    renderWithProviders(<DocumentsList />);

    expect(
      await screen.findByText(/no documents uploaded yet/i),
    ).toBeInTheDocument();
  });

  it('renders each document with its chunk count', async () => {
    listQueryFn.mockResolvedValue([
      { filename: 'a.pdf', count: 3, uploadTimestamp: 1 },
      { filename: 'b.txt', count: 1, uploadTimestamp: 2 },
    ]);

    renderWithProviders(<DocumentsList />);

    expect(await screen.findByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('3 chunks')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(screen.getByText('1 chunks')).toBeInTheDocument();
  });

  it('deletes a document by filename and toasts on success', async () => {
    listQueryFn.mockResolvedValue([
      { filename: 'a.pdf', count: 3, uploadTimestamp: 1 },
    ]);
    deleteSpy.mockResolvedValue({ deletedCount: 3, filename: 'a.pdf' });

    renderWithProviders(<DocumentsList />);

    const deleteButton = await screen.findByRole('button', {
      name: /delete a\.pdf/i,
    });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      // react-query v5 passes (variables, { client }) to mutationFn.
      expect(deleteSpy).toHaveBeenCalledWith(
        { filename: 'a.pdf' },
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Document deleted');
    });
  });
});
