/**
 * DocumentsList — integration/components.
 *
 * Prop-driven, like the rail and `IngestProgressView`: the rows arrive already
 * narrowed to the Source the user is standing in, because `useDocumentsPage`
 * owns that scoping. So the cases worth pinning here are the presentation rules
 * with no network in them — the loading and empty states, the chunk counts, and
 * the Source name that earns its place only in the roll-up.
 *
 * The delete OUTCOME — the row leaving the DOM and the success toast — is
 * asserted on the page instead (`documents-page.test.tsx`), where it runs
 * through MSW, the real `useDocuments` and a real QueryClient rather than a
 * callback.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@testing-library/jest-dom';

import type { DocumentRow } from '../../../../hooks/use-documents-page';
import { DocumentsList } from '../../../../components/documents-list';

const doc = (
  filename: string,
  count: number,
  dataSourceName = 'Work notes',
): DocumentRow => ({
  dataSourceId: '11111111-1111-4111-8111-111111111111',
  dataSourceName,
  filename,
  count,
  uploadTimestamp: 1,
});

const renderList = ({
  documents = [],
  isLoading = false,
  isRollUp = true,
  onDelete = () => {
    // the mutation is the page's; these cases assert the list's DOM only
  },
  isDeleting = false,
}: {
  documents?: DocumentRow[];
  isLoading?: boolean;
  isRollUp?: boolean;
  onDelete?: (dataSourceId: string, filename: string) => void;
  isDeleting?: boolean;
} = {}) =>
  render(
    <DocumentsList
      documents={documents}
      isLoading={isLoading}
      isRollUp={isRollUp}
      onDelete={onDelete}
      isDeleting={isDeleting}
    />,
  );

describe('DocumentsList', () => {
  it('shows a loading state while the list is pending', () => {
    renderList({ isLoading: true });

    expect(screen.getByText(/loading documents/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no documents', () => {
    renderList();

    expect(screen.getByText(/no documents uploaded yet/i)).toBeInTheDocument();
  });

  it('names each row’s Source in the roll-up', () => {
    renderList({
      documents: [doc('a.pdf', 3), doc('return.pdf', 1, 'Tax')],
      isRollUp: true,
    });

    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('Work notes · 3 chunks')).toBeInTheDocument();
    expect(screen.getByText('Tax · 1 chunks')).toBeInTheDocument();
  });

  it('drops the Source name inside one Source, where it would repeat', () => {
    renderList({ documents: [doc('a.pdf', 3)], isRollUp: false });

    expect(screen.getByText('3 chunks')).toBeInTheDocument();
    expect(screen.queryByText(/Work notes ·/)).not.toBeInTheDocument();
  });

  it('disables the row trash while a delete is in flight', () => {
    renderList({ documents: [doc('a.pdf', 3)], isDeleting: true });

    expect(
      screen.getByRole('button', { name: /delete a\.pdf/i }),
    ).toBeDisabled();
  });
});
