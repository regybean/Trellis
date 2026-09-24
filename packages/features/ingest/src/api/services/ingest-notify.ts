import type { FailureReason } from '@acme/provider-errors';
import { publish } from '@acme/notifications/server';
import { failureMessage } from '@acme/provider-errors';

// The `kind` the ingest completion notification carries — the open dispatch key
// the app's renderer registry keys off (dotted `feature.event`, ADR: colon is
// reserved for `nsKey` Redis segments). The client registers a renderer for
// this exact string; an unregistered app falls back to the default toast.
export const INGEST_JOB_COMPLETE_KIND = 'ingest.job-complete';

// The settled path's sibling: a Job that did not settle at all. Its own kind,
// because the two carry different payloads and a renderer keyed on
// completion's tally would find none of it.
export const INGEST_JOB_FAILED_KIND = 'ingest.job-failed';

// One content-failed Upload in a settled Job's tally: the file plus why it failed.
export interface JobFailure {
  uploadId: string;
  filename: string;
  error: string;
}

// The structured completion summary a Job settles to — computed from its Uploads
// (a Job is derived, never persisted). Rides in the notification `data` for a
// custom renderer to parse.
export interface JobCompleteSummary {
  jobId: string;
  total: number;
  succeeded: number;
  failed: JobFailure[];
}

// Ingest's typed one-line wrapper around the generic `publish` (the
// notifications core owns the envelope, never the kinds; a feature owns its own
// wrapper). Fired exactly once, on the settled path, by the processor.
export function notifyJobComplete(userId: string, summary: JobCompleteSummary) {
  const failedCount = summary.failed.length;
  const docWord = summary.succeeded === 1 ? 'document' : 'documents';
  const message =
    failedCount === 0
      ? `${summary.succeeded} ${docWord} indexed`
      : // A count alone leaves the user with nothing to act on. Every failure
        // that reaches this path is a content failure — the file yielded no
        // text — so the cause is known here without classifying anything, and
        // it tells the user re-uploading the same file will not help.
        `${summary.succeeded} of ${summary.total} documents indexed, ${failedCount} failed — no readable text to index`;

  return publish(userId, {
    kind: INGEST_JOB_COMPLETE_KIND,
    // The Job stays green even when individual files content-fail; the toast
    // severity reflects whether every file made it.
    level: failedCount === 0 ? 'success' : 'error',
    message,
    data: { ...summary },
  });
}

// What a Job that failed outright reports: the batch it was, and the one
// reason the failure reduced to. `retryable` is deliberately absent — it is
// derived from the reason wherever it is needed, so it never travels and the
// two can never disagree.
export interface JobFailedSummary {
  jobId: string;
  total: number;
  reason: FailureReason;
}

// Fired once when a Job fails as a whole — no per-file tally, because the
// files did not each reach a terminal. The reason is what turns "indexing
// failed" into something a user can act on: whether to wait or to stop
// retrying. The provider's own error text stays in the logs, where the detail
// is useful and the audience is an operator.
export function notifyJobFailed(userId: string, summary: JobFailedSummary) {
  return publish(userId, {
    kind: INGEST_JOB_FAILED_KIND,
    level: 'error',
    message: `Indexing failed. ${failureMessage(summary.reason)}`,
    data: { ...summary },
  });
}
