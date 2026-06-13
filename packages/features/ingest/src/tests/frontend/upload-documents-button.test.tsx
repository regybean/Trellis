import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadDocumentsButton } from '../../components/upload-documents-button';
import { renderWithProviders } from './setup';

// Spies the mocked tRPC mutations delegate to.
const getPresignedSpy = vi.fn();
const uploadFromS3Spy = vi.fn();

vi.mock('../../trpc/react', () => ({
  useTRPC: () => ({
    documents: {
      list: { pathFilter: () => ({ queryKey: ['documents', 'list'] }) },
      getPresignedUploadUrls: {
        mutationOptions: (opts?: { onError?: (e: unknown) => void }) => ({
          mutationFn: getPresignedSpy,
          ...opts,
        }),
      },
      uploadFromS3: {
        mutationOptions: (opts?: {
          onSuccess?: () => void;
          onError?: (e: unknown) => void;
        }) => ({ mutationFn: uploadFromS3Spy, ...opts }),
      },
    },
  }),
}));

function selectFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>(
    '#documents-upload-input',
  );
  expect(input).not.toBeNull();
  // jsdom won't accept files via fireEvent's target init, so set it directly.
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input!);
}

describe('UploadDocumentsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, statusText: 'OK' }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the upload button', () => {
    renderWithProviders(<UploadDocumentsButton />);

    expect(
      screen.getByRole('button', { name: /upload documents/i }),
    ).toBeInTheDocument();
  });

  it('rejects unsupported file types without requesting presigned URLs', async () => {
    renderWithProviders(<UploadDocumentsButton />);

    selectFiles([
      new File(['x'], 'malware.exe', { type: 'application/x-msdownload' }),
    ]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(getPresignedSpy).not.toHaveBeenCalled();
  });

  it('presigns, uploads to S3, then indexes a valid file', async () => {
    getPresignedSpy.mockResolvedValue({
      uploadId: 'u1',
      presignedUrls: [
        {
          filename: 'doc.pdf',
          key: 'uploads/u1/doc.pdf',
          uploadUrl: 'https://s3.test/uploads/u1/doc.pdf',
        },
      ],
    });
    uploadFromS3Spy.mockResolvedValue(undefined);

    renderWithProviders(<UploadDocumentsButton />);

    selectFiles([new File(['x'], 'doc.pdf', { type: 'application/pdf' })]);

    await waitFor(() => {
      // react-query v5 passes (variables, { client }) to mutationFn.
      expect(getPresignedSpy).toHaveBeenCalledWith(
        { files: [{ filename: 'doc.pdf', contentType: 'application/pdf' }] },
        expect.anything(),
      );
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://s3.test/uploads/u1/doc.pdf',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    await waitFor(() => {
      expect(uploadFromS3Spy).toHaveBeenCalledWith(
        { s3Keys: ['uploads/u1/doc.pdf'] },
        expect.anything(),
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Documents uploaded successfully',
      );
    });
  });
});
