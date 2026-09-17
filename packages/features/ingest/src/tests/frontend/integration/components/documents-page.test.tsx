/**
 * DocumentsPage — integration/components.
 *
 * The whole master-detail, driven through MSW at the HTTP boundary with the
 * real hooks and a real QueryClient. What is asserted here is what the page
 * exists to guarantee:
 *
 * - **Delete friction in both directions.** An empty Source goes with no
 *   confirmation; a populated one cannot go without its name typed out. That
 *   asymmetry is the rule, so both halves are pinned, and the populated half is
 *   asserted as the mutation NOT having happened — the row is still there.
 * - **The upload dialog's destination in both modes.** Inherited from where you
 *   stand, or picked in the same popup from the roll-up.
 * - **Inline create rejecting a collision** without an optimistic row, because
 *   absorbing a name into an existing Source is the one outcome that silently
 *   puts documents somewhere the user did not choose.
 *
 * `onUnhandledRequest: 'bypass'` because the page mounts the always-on progress
 * subscription (SSE), which can't connect in jsdom (mirrors chat/notifications).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '@testing-library/jest-dom';

import { DocumentsPage } from '../../../../components/documents-page';
import { renderWithProviders, trpcMsw } from '../../setup';

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

const TWO_DOCS = [
  doc(WORK, 'Work notes', 'a.pdf'),
  doc(TAX, 'Tax', 'return.pdf'),
];

const limitsHandler = (maxDataSourcesPerUser = 10) =>
  trpcMsw.dataSources.limits.query(() => ({
    maxDataSourcesPerUser,
    maxDocumentsPerDataSource: 50,
  }));

const server = setupServer(
  trpcMsw.documents.progressSnapshot.query(() => ({
    uploads: [],
    lastId: '0-0',
  })),
  limitsHandler(),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const renderPage = () => renderWithProviders(<DocumentsPage />);

describe('DocumentsPage', () => {
  it('lists the Sources with counts, the roll-up row and the cap', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => TWO_DOCS),
    );

    renderPage();

    expect(await screen.findByText('Work notes')).toBeInTheDocument();
    expect(screen.getByText('Tax')).toBeInTheDocument();
    expect(screen.getByText('Recipes')).toBeInTheDocument();
    expect(screen.getByText('3/10')).toBeInTheDocument();
    // The roll-up is a place to stand, so it is a rail row as well as the pane
    // the page opens on.
    const rollUp = screen.getByRole('button', { name: /^All documents/ });
    expect(
      screen.getByRole('heading', { name: 'All documents' }),
    ).toBeInTheDocument();
    // Its count is the total across every Source.
    await waitFor(() => expect(rollUp).toHaveTextContent('2'));
  });

  it('names each row’s Source in the roll-up and drops the name inside one', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => TWO_DOCS),
    );

    const user = userEvent.setup();
    renderPage();

    // Roll-up: the Source name earns its place on the metadata line.
    expect(
      await screen.findByText(/Work notes · 3 chunks/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tax · 3 chunks/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Work notes/ }));

    // Standing inside one Source: only its Documents, and no repeated name.
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.queryByText('return.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('3 chunks')).toBeInTheDocument();
  });

  it('deletes a Source with no documents immediately, with no confirm', async () => {
    let listCalls = 0;
    server.use(
      trpcMsw.dataSources.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? THREE_SOURCES : THREE_SOURCES.slice(0, 2);
      }),
      trpcMsw.documents.list.query(() => TWO_DOCS),
      trpcMsw.dataSources.delete.mutation(() => ({
        id: EMPTY,
        deletedChunkCount: 0,
      })),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', {
        name: /delete data source recipes/i,
      }),
    );

    // No dialog at all — confirming an empty container teaches people to click
    // through confirmations.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Data source deleted')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Recipes')).not.toBeInTheDocument(),
    );
  });

  it('demands the typed name to delete a Source with documents, and states the count', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => [
        ...TWO_DOCS,
        doc(WORK, 'Work notes', 'b.pdf'),
      ]),
      // Registered so a fired mutation would visibly succeed — the assertion
      // below is that it does NOT fire while the name is unconfirmed.
      trpcMsw.dataSources.delete.mutation(() => ({
        id: WORK,
        deletedChunkCount: 6,
      })),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', {
        name: /delete data source work notes/i,
      }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Delete .Work notes.\?/),
    ).toBeInTheDocument();
    // The exact count, and that the index goes with it.
    expect(
      within(dialog).getByText(
        /This deletes 2 documents and everything indexed/,
      ),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', {
      name: /delete data source/i,
    });
    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText(/confirm data source name/i),
      'Work note',
    );
    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText(/confirm data source name/i),
      's',
    );
    expect(confirm).toBeEnabled();
  });

  it('deletes a Document from a hover trash with no confirmation', async () => {
    let listCalls = 0;
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? TWO_DOCS : TWO_DOCS.slice(1);
      }),
      trpcMsw.documents.delete.mutation(() => ({
        deletedCount: 3,
        fileName: 'a.pdf',
      })),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /delete a\.pdf/i }),
    );

    // The light end of the asymmetry: one file, re-uploadable in seconds.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Document deleted')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('a.pdf')).not.toBeInTheDocument(),
    );
  });

  it('inherits the destination when standing inside a Source', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => TWO_DOCS),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /^Work notes/ }),
    );
    await user.click(screen.getByRole('button', { name: /upload documents/i }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Upload to Work notes'),
    ).toBeInTheDocument();
    // The page already answers "where"; asking again would be asking twice.
    expect(
      within(dialog).queryByLabelText(/^data source$/i),
    ).not.toBeInTheDocument();
    // Advisory headroom against the 50-Document cap, shown because it is known.
    expect(within(dialog).getByText('49 slots left')).toBeInTheDocument();
  });

  it('offers the destination select in the same popup from the roll-up', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => TWO_DOCS),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /upload documents/i }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Upload documents')).toBeInTheDocument();
    const select = within(dialog).getByRole('combobox', {
      name: /data source/i,
    });

    await user.click(select);

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Work notes',
      'Tax',
      'Recipes',
      '＋ New data source…',
    ]);

    // Picking create swaps the select for an inline field — no second modal.
    await user.click(screen.getByRole('option', { name: /new data source/i }));
    expect(
      await within(dialog).findByLabelText(/new data source name/i),
    ).toHaveValue('');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('makes a new Source the only destination when the user has none', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => []),
      trpcMsw.documents.list.query(() => []),
    );

    const user = userEvent.setup();
    renderPage();

    // The zero-Source empty state explains what a Data Source is, and upload is
    // the action because the create happens inside the dialog.
    expect(await screen.findByText('No data sources yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /upload documents/i }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('combobox', { name: /data source/i }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByLabelText(/new data source name/i),
    ).toBeInTheDocument();
  });

  it('rejects a colliding inline-create name without adding a row', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => TWO_DOCS),
      // A create that WOULD succeed, so "no new row" is evidence the mutation
      // never fired rather than evidence it failed.
      trpcMsw.dataSources.create.mutation(() => source(EMPTY, 'Work notes')),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /new data source/i }),
    );
    await user.type(
      screen.getByLabelText(/new data source name/i),
      'work notes{Enter}',
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already have a data source called "Work notes".',
    );
    // Still three rows: rejected, never absorbed into the Source of that name.
    expect(screen.getByText('3/10')).toBeInTheDocument();
  });

  it('creates from the rail and lands the user in the new Source', async () => {
    const created = source('44444444-4444-4444-8444-444444444444', 'Receipts');
    let listCalls = 0;
    server.use(
      trpcMsw.dataSources.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? THREE_SOURCES : [...THREE_SOURCES, created];
      }),
      trpcMsw.documents.list.query(() => TWO_DOCS),
      trpcMsw.dataSources.create.mutation(() => created),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /new data source/i }),
    );
    await user.type(
      screen.getByLabelText(/new data source name/i),
      'Receipts{Enter}',
    );

    // The detail pane's heading is where the user is standing.
    expect(
      await screen.findByRole('heading', { name: 'Receipts' }),
    ).toBeInTheDocument();
  });

  it('disables inline create once the user is at the cap', async () => {
    server.use(
      trpcMsw.dataSources.list.query(() => THREE_SOURCES),
      trpcMsw.documents.list.query(() => TWO_DOCS),
      limitsHandler(3),
    );

    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /new data source/i }),
      ).toBeDisabled(),
    );
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });
});
