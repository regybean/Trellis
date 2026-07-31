/**
 * useDocumentUpload — integration/hooks (ADR 0018).
 *
 * The async upload protocol (presign → direct S3 PUT → enqueue ingest Job) is
 * faked at the HTTP boundary: tRPC via `trpcMsw`, S3 PUT via plain MSW `http.put`.
 * We drive `upload()` and assert the derived `files`/`summary` and the toast
 * output — never mock-call counts.
 *
 * `onUnhandledRequest: 'bypass'` because the hook opens the ALWAYS-ON progress
 * subscription (SSE) on mount; it can't connect in jsdom and is left to fail
 * silently (mirrors chat/notifications). The server-authored `serverStage`
 * advances + the completion `invalidate` are SSE-driven and therefore NOT
 * drivable here — they are covered by the reducer unit tests; this file drives
 * only the client-authored half (uploading / optimistic queued / failures).
 */
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useDocumentUpload } from '../../../../hooks/use-document-upload';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const pdfFile = (name = 'doc.pdf') =>
  new File(['content'], name, { type: 'application/pdf' });

const presignResponse = (jobId: string, uploadIds: string[]) => ({
  jobId,
  uploads: uploadIds.map((uploadId, i) => ({
    uploadId,
    filename: `doc${i}.pdf`,
    s3Key: `uploads/${jobId}/${uploadId}/doc${i}.pdf`,
    uploadUrl: `https://s3.test/uploads/${jobId}/${uploadId}/doc${i}.pdf`,
  })),
});

const presignHandler = (jobId: string, uploadIds: string[]) =>
  trpcMsw.documents.getPresignedUploadUrls.mutation(() =>
    presignResponse(jobId, uploadIds),
  );

const s3Ok = () =>
  http.put('https://s3.test/*', () => new HttpResponse(null, { status: 200 }));

const startHandler = (jobId: string) =>
  trpcMsw.documents.startIngestJob.mutation(() => ({ jobId }));

const renderUpload = () =>
  renderHook(() => useDocumentUpload(), { wrapper: Providers });

describe('useDocumentUpload', () => {
  it('starts with an empty file list and a zeroed summary', () => {
    const { result } = renderUpload();
    expect(result.current.files).toEqual([]);
    expect(result.current.summary.total).toBe(0);
    expect(result.current.summary.isComplete).toBe(false);
  });

  it('exposes the accept string and max file size', () => {
    const { result } = renderUpload();
    expect(result.current.accept).toContain('.pdf');
    expect(result.current.maxFileSizeBytes).toBeGreaterThan(0);
  });

  it('does nothing for an empty file list', async () => {
    const { result } = renderUpload();
    await act(() => result.current.upload([]));
    expect(result.current.files).toEqual([]);
  });

  it('seeds an uploading row while the S3 PUT is in flight', async () => {
    let resolvePut!: () => void;
    const putGate = new Promise<HttpResponse<null>>((resolve) => {
      resolvePut = () => resolve(new HttpResponse(null, { status: 200 }));
    });
    server.use(
      presignHandler('job-1', ['u1']),
      http.put('https://s3.test/*', () => putGate),
      startHandler('job-1'),
    );

    const { result } = renderUpload();
    act(() => void result.current.upload([pdfFile()]));

    // Presign resolved, PUT pending → the row sits at `uploading`.
    await waitFor(() => expect(result.current.files).toHaveLength(1));
    expect(result.current.files[0]?.stage).toBe('uploading');
    expect(result.current.summary.inProgress).toBe(1);

    act(() => resolvePut());
    // PUT + enqueue settle → optimistic `queued`.
    await waitFor(() => expect(result.current.files[0]?.stage).toBe('queued'));
  });

  it('advances to optimistic queued after the full happy path', async () => {
    server.use(presignHandler('job-1', ['u1']), s3Ok(), startHandler('job-1'));

    const { result } = renderUpload();
    await act(() => result.current.upload([pdfFile()]));

    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0]?.stage).toBe('queued');
    expect(result.current.summary.total).toBe(1);
  });

  it('toasts a validation error and makes no request for an unsupported type', async () => {
    const { result } = renderUpload();
    await act(() =>
      result.current.upload([
        new File(['x'], 'malware.exe', { type: 'application/x-msdownload' }),
      ]),
    );

    expect(
      await screen.findByText(/unsupported file format: malware\.exe/i),
    ).toBeInTheDocument();
    expect(result.current.files).toEqual([]);
  });

  it('fails only the file whose S3 PUT rejects (in-list, not toasted)', async () => {
    server.use(
      presignHandler('job-1', ['u1']),
      http.put(
        'https://s3.test/*',
        () => new HttpResponse(null, { status: 403, statusText: 'Forbidden' }),
      ),
      startHandler('job-1'),
    );

    const { result } = renderUpload();
    await act(() => result.current.upload([pdfFile()]));

    await waitFor(() => expect(result.current.files[0]?.stage).toBe('failed'));
    expect(result.current.summary.failed).toBe(1);
  });

  it('toasts and fails the batch when presign rejects', async () => {
    server.use(
      trpcMsw.documents.getPresignedUploadUrls.mutation(() => {
        throw new Error('presign failed');
      }),
    );

    const { result } = renderUpload();
    await act(() => result.current.upload([pdfFile()]));

    // The tRPC reject is toasted as an error (exact message is transport-shaped).
    await waitFor(() =>
      expect(document.querySelector('.Toastify__toast--error')).not.toBeNull(),
    );
    expect(result.current.files).toEqual([]);
  });

  it('toasts and fails PUT-succeeded files when enqueue rejects', async () => {
    server.use(
      presignHandler('job-1', ['u1']),
      s3Ok(),
      trpcMsw.documents.startIngestJob.mutation(() => {
        throw new Error('enqueue failed');
      }),
    );

    const { result } = renderUpload();
    await act(() => result.current.upload([pdfFile()]));

    await waitFor(() =>
      expect(document.querySelector('.Toastify__toast--error')).not.toBeNull(),
    );
    await waitFor(() => expect(result.current.files[0]?.stage).toBe('failed'));
  });
});
