/**
 * UploadDocumentsButton — integration/components.
 *
 * The button is UI-only: it drives the shared `useDocumentUpload` (via
 * `IngestUploadProvider`) that `IngestProgress` also reads, so a batch triggered
 * here streams into the panel. We assert what the user sees — the destination
 * control, the button, and the client-side validation toast — never mutation
 * calls. The happy-path protocol is covered by the hook + progress-UI
 * integration tests.
 *
 * An upload takes exactly one Data Source and it is mandatory, so the component
 * has two shapes and both are asserted: with Sources it offers a destination
 * select, and with none it offers inline create instead, because a new Source
 * is then the only possible destination.
 *
 * `onUnhandledRequest: 'bypass'` because the provider opens the always-on progress
 * subscription (SSE) that can't connect in jsdom (mirrors chat/notifications).
 */
import type { UserEvent } from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '@testing-library/jest-dom';

import { UploadDocumentsButton } from '../../../../components/upload-documents-button';
import { IngestUploadProvider } from '../../../../hooks/ingest-upload-context';
import { renderWithProviders, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const source = (name: string) => ({
  id: crypto.randomUUID(),
  ownerId: 'user-1',
  name,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const listHandler = (sources: ReturnType<typeof source>[]) =>
  trpcMsw.dataSources.list.query(() => sources);

const renderButton = () =>
  renderWithProviders(
    <IngestUploadProvider>
      <UploadDocumentsButton />
    </IngestUploadProvider>,
  );

/**
 * Drive the hidden file input. Callers uploading a disallowed extension must build
 * `user` with `userEvent.setup({ applyAccept: false })` so the browser's `accept`
 * filter doesn't drop the file before our own `validateFiles` sees it.
 */
async function selectFiles(user: UserEvent, files: File[]) {
  const input = document.querySelector<HTMLInputElement>(
    '#documents-upload-input',
  );
  if (!input) throw new Error('upload input not found');
  await user.upload(input, files);
}

describe('UploadDocumentsButton', () => {
  it('renders the upload button with the only Data Source preselected', async () => {
    const only = source('Work notes');
    server.use(listHandler([only]));
    renderButton();

    expect(
      await screen.findByRole('button', { name: /upload documents/i }),
    ).toBeEnabled();
    // Preselected at exactly one Source — upload targeting is not the privacy
    // boundary, so a default is safe here in a way it is not in chat.
    expect(screen.getByRole('combobox', { name: /data source/i })).toHaveValue(
      only.id,
    );
  });

  it('offers inline create instead of a picker when no Data Source exists', async () => {
    server.use(listHandler([]));
    renderButton();

    expect(
      await screen.findByRole('button', { name: /create data source/i }),
    ).toBeInTheDocument();
    // Placeholder, never a prefill: a field pre-filled with a name gets
    // accepted unread.
    expect(screen.getByLabelText(/new data source name/i)).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: /upload documents/i }),
    ).not.toBeInTheDocument();
  });

  it('shows an error toast for an unsupported file type (no upload)', async () => {
    server.use(listHandler([source('Work notes')]));
    const user = userEvent.setup({ applyAccept: false });
    renderButton();
    await screen.findByRole('button', { name: /upload documents/i });

    await selectFiles(user, [
      new File(['x'], 'malware.exe', { type: 'application/x-msdownload' }),
    ]);

    expect(
      await screen.findByText(/unsupported file format: malware\.exe/i),
    ).toBeInTheDocument();
  });
});
