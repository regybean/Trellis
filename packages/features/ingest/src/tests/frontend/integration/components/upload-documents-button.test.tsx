/**
 * UploadDocumentsButton — integration/components (ADR 0018).
 *
 * The button is UI-only: it drives the shared `useDocumentUpload` (via
 * `IngestUploadProvider`) that `IngestProgress` also reads, so a batch triggered
 * here streams into the panel. We assert what the user sees — the button, and the
 * client-side validation toast — never mutation calls. The happy-path protocol is
 * covered by the hook + progress-UI integration tests.
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
import { renderWithProviders } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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
  it('renders the upload button', () => {
    renderButton();
    expect(
      screen.getByRole('button', { name: /upload documents/i }),
    ).toBeInTheDocument();
  });

  it('shows an error toast for an unsupported file type (no upload)', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderButton();

    await selectFiles(user, [
      new File(['x'], 'malware.exe', { type: 'application/x-msdownload' }),
    ]);

    expect(
      await screen.findByText(/unsupported file format: malware\.exe/i),
    ).toBeInTheDocument();
  });
});
