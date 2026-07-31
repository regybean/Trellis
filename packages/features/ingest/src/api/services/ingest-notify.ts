import { publish } from '@acme/notifications/server';

// The `kind` the ingest completion notification carries — the open dispatch key
// the app's renderer registry keys off (dotted `feature.event`, ADR: colon is
// reserved for `nsKey` Redis segments). The client (#189) registers a renderer
// for this exact string; an unregistered app falls back to the default toast.
export const INGEST_JOB_COMPLETE_KIND = 'ingest.job-complete';

// The structured completion summary a Job settles to — computed from its Uploads
// (a Job is derived, never persisted). Rides in the notification `data` for a
// custom renderer to parse.
export interface JobCompleteSummary {
  jobId: string;
  total: number;
  succeeded: number;
  failed: { uploadId: string; filename: string; error: string }[];
}

// Ingest's typed one-line wrapper around the generic `publish` (ADR 0030 — the
// notifications core owns the envelope, never the kinds; a feature owns its own
// wrapper). Fired exactly once, on the settled path, by the processor.
export function notifyJobComplete(userId: string, summary: JobCompleteSummary) {
  const failedCount = summary.failed.length;
  const docWord = summary.succeeded === 1 ? 'document' : 'documents';
  const message =
    failedCount === 0
      ? `${summary.succeeded} ${docWord} indexed`
      : `${summary.succeeded} of ${summary.total} documents indexed, ${failedCount} failed`;

  return publish(userId, {
    kind: INGEST_JOB_COMPLETE_KIND,
    // The Job stays green even when individual files content-fail; the toast
    // severity reflects whether every file made it.
    level: failedCount === 0 ? 'success' : 'error',
    message,
    data: {
      jobId: summary.jobId,
      total: summary.total,
      succeeded: summary.succeeded,
      failed: summary.failed,
    },
  });
}
