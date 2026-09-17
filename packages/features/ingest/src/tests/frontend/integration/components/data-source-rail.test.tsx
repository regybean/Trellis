/**
 * DataSourceRail — integration/components.
 *
 * Prop-driven, like `IngestProgressView`: the rail's data comes from
 * `useDocumentsPage`, which the page test drives through MSW. Here we drive the
 * rail directly and assert only what it renders, because the cases worth
 * pinning at this level are presentation rules with no network in them — the
 * cap display, the disabled create control, and the spinner that stands in for
 * a count.
 *
 * Everything with an outcome beyond the rail's own DOM — create, collision,
 * selection, delete friction — is asserted on the page instead, where the
 * outcome is a row appearing or a mutation not happening rather than a callback
 * being invoked.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@testing-library/jest-dom';

import type { DataSourceSummary } from '../../../../hooks/use-documents-page';
import { DataSourceRail } from '../../../../components/data-source-rail';

const summary = (
  over: Partial<DataSourceSummary> & { name: string },
): DataSourceSummary => ({
  id: crypto.randomUUID(),
  documentCount: 0,
  hasUploadInFlight: false,
  ...over,
});

const noop = () => {
  // the rail's callbacks belong to the page; these cases assert its DOM only
};

// None of the cases below commits a name, so this resolves to no row.
const neverCreates = async (): Promise<undefined> => {
  await Promise.resolve();
};

const renderRail = ({
  sources = [] as DataSourceSummary[],
  totalDocumentCount = 0,
  maxDataSourcesPerUser = 10 as number | undefined,
} = {}) =>
  render(
    <DataSourceRail
      sources={sources}
      selectedId={null}
      onSelect={noop}
      totalDocumentCount={totalDocumentCount}
      maxDataSourcesPerUser={maxDataSourcesPerUser}
      onCreate={neverCreates}
      isCreating={false}
      onDelete={noop}
    />,
  );

describe('DataSourceRail', () => {
  it('lists every Source with its count, the roll-up row, and N/10', () => {
    renderRail({
      sources: [
        summary({ name: 'Work notes', documentCount: 4 }),
        summary({ name: 'Tax', documentCount: 1 }),
        summary({ name: 'Recipes', documentCount: 0 }),
      ],
      totalDocumentCount: 5,
    });

    expect(screen.getByText('All documents')).toBeInTheDocument();
    expect(screen.getByText('Work notes')).toBeInTheDocument();
    expect(screen.getByText('Tax')).toBeInTheDocument();
    expect(screen.getByText('Recipes')).toBeInTheDocument();
    expect(screen.getByText('3/10')).toBeInTheDocument();
  });

  it('disables ＋ New data source at the cap', () => {
    renderRail({
      sources: [summary({ name: 'Only' }), summary({ name: 'Other' })],
      maxDataSourcesPerUser: 2,
    });

    expect(
      screen.getByRole('button', { name: /new data source/i }),
    ).toBeDisabled();
  });

  it('keeps create live while the cap is still unknown', () => {
    // An advisory check that guesses is worse than one that waits — presign
    // rejects the create either way.
    renderRail({
      sources: [summary({ name: 'Only' })],
      maxDataSourcesPerUser: undefined,
    });

    expect(
      screen.getByRole('button', { name: /new data source/i }),
    ).toBeEnabled();
  });

  it('swaps the in-flight Source row count for a spinner', () => {
    renderRail({
      sources: [
        summary({
          name: 'Work notes',
          documentCount: 4,
          hasUploadInFlight: true,
        }),
        summary({ name: 'Tax', documentCount: 1 }),
      ],
    });

    // The only trace of an in-flight batch from outside its own Source.
    expect(screen.getByText('Upload in progress')).toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('offers a delete control per Source and none for the roll-up', () => {
    renderRail({ sources: [summary({ name: 'Work notes' })] });

    expect(
      screen.getByRole('button', { name: /delete data source work notes/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /delete data source all documents/i,
      }),
    ).not.toBeInTheDocument();
  });
});
