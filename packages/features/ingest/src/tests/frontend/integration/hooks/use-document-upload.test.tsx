/**
 * useDocumentUpload — integration/hooks (ADR 0018).
 *
 * The three-step upload protocol (presign → direct S3 PUT → server index) is
 * faked at the HTTP boundary: tRPC via trpcMsw, S3 PUT via plain MSW http.put.
 * Assert returned status transitions and toast output — never mock-call counts.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useDocumentUpload } from '../../../../hooks/use-document-upload';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const pdfFile = () =>
  new File(['content'], 'doc.pdf', { type: 'application/pdf' });

const presignHandler = (uploadId = crypto.randomUUID()) =>
  trpcMsw.documents.getPresignedUploadUrls.mutation(() => ({
    uploadId,
    presignedUrls: [
      {
        filename: 'doc.pdf',
        key: `uploads/${uploadId}/doc.pdf`,
        uploadUrl: `https://s3.test/uploads/${uploadId}/doc.pdf`,
      },
    ],
  }));

const s3PutHandler = () =>
  http.put('https://s3.test/*', () => new HttpResponse(null, { status: 200 }));

const indexHandler = () =>
  trpcMsw.documents.uploadFromS3.mutation(() => {
    // void return
  });

const renderUseDocumentUpload = () =>
  renderHook(() => useDocumentUpload(), { wrapper: Providers });

describe('useDocumentUpload', () => {
  it('starts idle', () => {
    // No handlers needed — status is synchronous initial state.
    // Register a never-resolving presign so any accidental upload doesn't trip
    // onUnhandledRequest.
    server.use(
      trpcMsw.documents.getPresignedUploadUrls.mutation(
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        () => new Promise<never>(() => {}),
      ),
    );

    const { result } = renderUseDocumentUpload();

    expect(result.current.status).toBe('idle');
  });

  it('exposes accept string and maxFileSizeBytes', () => {
    server.use(
      trpcMsw.documents.getPresignedUploadUrls.mutation(
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        () => new Promise<never>(() => {}),
      ),
    );

    const { result } = renderUseDocumentUpload();

    expect(result.current.accept).toContain('.pdf');
    expect(result.current.maxFileSizeBytes).toBeGreaterThan(0);
  });

  it('does nothing when called with an empty file list', async () => {
    // No handlers — onUnhandledRequest:'error' catches any spurious request.
    const { result } = renderUseDocumentUpload();

    await act(() => result.current.upload([]));

    expect(result.current.status).toBe('idle');
  });

  it('transitions to uploading then back to idle on success', async () => {
    const presignResponse = {
      uploadId: crypto.randomUUID(),
      presignedUrls: [
        {
          filename: 'doc.pdf',
          key: 'uploads/u1/doc.pdf',
          uploadUrl: 'https://s3.test/uploads/u1/doc.pdf',
        },
      ],
    };
    let resolvePresign!: (v: typeof presignResponse) => void;

    server.use(
      trpcMsw.documents.getPresignedUploadUrls.mutation(
        () =>
          new Promise<typeof presignResponse>((resolve) => {
            resolvePresign = resolve;
          }),
      ),
      s3PutHandler(),
      indexHandler(),
    );

    const { result } = renderUseDocumentUpload();

    act(() => void result.current.upload([pdfFile()]));

    await waitFor(() => expect(result.current.status).toBe('uploading'));

    act(() => resolvePresign(presignResponse));
    await waitFor(() => expect(result.current.status).toBe('idle'));
  });

  it('completes full protocol and returns idle with no error', async () => {
    server.use(presignHandler(), s3PutHandler(), indexHandler());

    const { result } = renderUseDocumentUpload();

    await act(() => result.current.upload([pdfFile()]));

    expect(result.current.status).toBe('idle');
  });

  it('returns idle (no throw) when presign fails', async () => {
    server.use(
      trpcMsw.documents.getPresignedUploadUrls.mutation(() => {
        throw new Error('presign failed');
      }),
    );

    const { result } = renderUseDocumentUpload();

    await act(() => result.current.upload([pdfFile()]));

    expect(result.current.status).toBe('idle');
  });

  it('returns idle (no throw) when the S3 PUT fails', async () => {
    server.use(
      presignHandler(),
      http.put(
        'https://s3.test/*',
        () => new HttpResponse(null, { status: 403, statusText: 'Forbidden' }),
      ),
    );

    const { result } = renderUseDocumentUpload();

    await act(() => result.current.upload([pdfFile()]));

    expect(result.current.status).toBe('idle');
  });

  it('returns idle (no throw) when indexing fails', async () => {
    server.use(
      presignHandler(),
      s3PutHandler(),
      trpcMsw.documents.uploadFromS3.mutation(() => {
        throw new Error('index failed');
      }),
    );

    const { result } = renderUseDocumentUpload();

    await act(() => result.current.upload([pdfFile()]));

    expect(result.current.status).toBe('idle');
  });
});
