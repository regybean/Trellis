/**
 * IngestProgress (Variant A dense rows) — integration/components (ADR 0018).
 *
 * The pure `IngestProgressView` is driven directly with synthetic hook state
 * (files + summary) and asserted through the rendered DOM — the SSE tail that
 * feeds it in production isn't drivable in jsdom, so the view is prop-driven and
 * tested in isolation. Assert per-file rows, stage pills, in-list failure lines,
 * and the summary strip.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@testing-library/jest-dom';

import type {
  PerFileProgress,
  ProgressSummary,
  Stage,
} from '../../../../hooks/ingest-progress-reducer';
import { IngestProgressView } from '../../../../components/ingest-progress';
import {
  deriveFiles,
  deriveSummary,
} from '../../../../hooks/ingest-progress-reducer';

// `PerFileProgress` is a discriminated union (`error` only on `failed`), so the
// factory branches rather than spreading a flat partial over it.
const file = (
  over: {
    jobId?: string;
    uploadId?: string;
    filename?: string;
    stage?: Stage;
    error?: string;
  } = {},
): PerFileProgress => {
  const base = {
    jobId: over.jobId ?? 'job-1',
    uploadId: over.uploadId ?? 'u1',
    filename: over.filename ?? 'doc.pdf',
  };
  const stage = over.stage ?? 'parsing';
  return stage === 'failed'
    ? { ...base, stage, error: over.error ?? 'failed' }
    : { ...base, stage };
};

const renderView = (files: PerFileProgress[], summary?: ProgressSummary) =>
  render(
    <IngestProgressView
      files={files}
      summary={summary ?? deriveSummary(files)}
    />,
  );

describe('IngestProgressView', () => {
  it('renders nothing when there are no files', () => {
    const { container } = renderView([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per file with its stage pill', () => {
    renderView([
      file({ uploadId: 'u1', filename: 'a.pdf', stage: 'parsing' }),
      file({ uploadId: 'u2', filename: 'b.pdf', stage: 'done' }),
    ]);

    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('b.pdf')).toBeInTheDocument();
    expect(screen.getByText('Parsing')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('shows the in-list error line only for a failed file', () => {
    renderView([
      file({ uploadId: 'u1', filename: 'ok.pdf', stage: 'embedding' }),
      file({
        uploadId: 'u2',
        filename: 'bad.pdf',
        stage: 'failed',
        error: 'unparseable document',
      }),
    ]);

    expect(screen.getByText('unparseable document')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    // Exactly one error line — the healthy row carries none.
    expect(screen.getAllByText(/unparseable document/)).toHaveLength(1);
  });

  it('renders the summary strip while a batch is in progress', () => {
    // 3 files: 1 done, 2 in-flight.
    renderView([
      file({ uploadId: 'u1', stage: 'done' }),
      file({ uploadId: 'u2', stage: 'parsing' }),
      file({ uploadId: 'u3', stage: 'uploading' }),
    ]);

    expect(screen.getByText('Ingesting 2 of 3…')).toBeInTheDocument();
    expect(screen.getByText('1 done · 0 failed')).toBeInTheDocument();
  });

  it('shows "Ingest complete" once every file is terminal', () => {
    renderView([
      file({ uploadId: 'u1', stage: 'done' }),
      file({ uploadId: 'u2', stage: 'failed', error: 'x' }),
    ]);

    expect(screen.getByText('Ingest complete')).toBeInTheDocument();
    expect(screen.getByText('1 done · 1 failed')).toBeInTheDocument();
  });

  it('renders from reducer-derived state end to end', () => {
    // Feed the panel the exact derivations the hook produces.
    const files = deriveFiles({
      byId: {
        u1: file({ uploadId: 'u1', filename: 'x.pdf', stage: 'done' }),
      },
      order: ['u1'],
    });
    renderView(files);
    expect(screen.getByText('x.pdf')).toBeInTheDocument();
    expect(screen.getByText('Ingest complete')).toBeInTheDocument();
  });
});
