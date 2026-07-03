/**
 * UploadDocumentsButton — integration/components (ADR 0018).
 *
 * The three-step upload protocol (presign → direct S3 PUT → server index) is
 * faked entirely at the HTTP boundary: tRPC via `trpcMsw`, the S3 PUT via a
 * plain MSW `http.put` handler (one frontier, MSW — no global `fetch` stub,
 * which would clobber MSW's tRPC interception). We assert the toast the user
 * sees, not the mutation calls.
 */
import type { UserEvent } from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import '@testing-library/jest-dom';

import { UploadDocumentsButton } from '../../../../components/upload-documents-button';
import { renderWithProviders, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Drive the hidden file input. Callers that upload a disallowed extension must
 * build `user` with `userEvent.setup({ applyAccept: false })` so the browser's
 * `accept` filter doesn't drop the file before our own `validateFiles` sees it —
 * `applyAccept` is read from the session config, not a per-call argument.
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
    renderWithProviders(<UploadDocumentsButton />);

    expect(
      screen.getByRole('button', { name: /upload documents/i }),
    ).toBeInTheDocument();
  });

  it('shows an error toast for an unsupported file type (no upload)', async () => {
    // Rejected client-side by validateFiles — no request is made, so no
    // handlers are registered and onUnhandledRequest:'error' would catch a leak.
    // applyAccept:false so the .exe reaches the component's own validateFiles.
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<UploadDocumentsButton />);

    await selectFiles(user, [
      new File(['x'], 'malware.exe', { type: 'application/x-msdownload' }),
    ]);

    expect(
      await screen.findByText(/unsupported file format: malware\.exe/i),
    ).toBeInTheDocument();
  });

  it('presigns, uploads to S3, indexes, and toasts success for a valid file', async () => {
    server.use(
      trpcMsw.documents.getPresignedUploadUrls.mutation(() => {
        const uploadId = crypto.randomUUID();
        return {
          uploadId,
          presignedUrls: [
            {
              filename: 'doc.pdf',
              key: `uploads/${uploadId}/doc.pdf`,
              uploadUrl: `https://s3.test/uploads/${uploadId}/doc.pdf`,
            },
          ],
        };
      }),
      http.put(
        'https://s3.test/*',
        () => new HttpResponse(null, { status: 200 }),
      ),
      trpcMsw.documents.uploadFromS3.mutation(() => {
        // indexing succeeded; the procedure returns void
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<UploadDocumentsButton />);

    await selectFiles(user, [
      new File(['x'], 'doc.pdf', { type: 'application/pdf' }),
    ]);

    expect(
      await screen.findByText('Documents uploaded successfully'),
    ).toBeInTheDocument();
  });
});
