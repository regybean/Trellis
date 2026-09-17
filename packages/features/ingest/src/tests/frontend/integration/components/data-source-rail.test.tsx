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
 * being invoked — including the blur rule, where the outcome of reaching for
 * another rail control mid-name is a Source appearing that should not.
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

// No case below commits a name, so the rail never calls this and the row it
// would resolve is never read — it exists to satisfy the prop.
const uncalledCreate = () => Promise.resolve({ id: 'never-read' });

interface RailOverrides {
  sources?: DataSourceSummary[];
  totalDocumentCount?: number;
  maxDataSourcesPerUser?: number;
  atCap?: boolean;
}

const renderRail = (over: RailOverrides = {}) => {
  const { sources = [], totalDocumentCount = 0, atCap = false } = over;
  // `undefined` is a REAL value for the cap — it means "not known yet" — so it
  // is read off the overrides rather than defaulted, which would silently turn
  // an explicit `undefined` into 10 and test the opposite case.
  const maxDataSourcesPerUser =
    'maxDataSourcesPerUser' in over ? over.maxDataSourcesPerUser : 10;

  return render(
    <DataSourceRail
      sources={sources}
      selectedId={null}
      onSelect={noop}
      totalDocumentCount={totalDocumentCount}
      maxDataSourcesPerUser={maxDataSourcesPerUser}
      atCap={atCap}
      onCreate={uncalledCreate}
      isCreating={false}
      onDelete={noop}
    />,
  );
};

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
      atCap: true,
    });

    expect(
      screen.getByRole('button', { name: /new data source/i }),
    ).toBeDisabled();
  });

  it('counts the Sources without a ceiling while the cap is unknown', () => {
    renderRail({
      sources: [summary({ name: 'Only' }), summary({ name: 'Other' })],
      maxDataSourcesPerUser: undefined,
    });

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/2\//)).not.toBeInTheDocument();
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
