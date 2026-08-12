// hooks/ingest-progress-reducer.ts
//
// The pure per-file progress state machine (#180). `useDocumentUpload` merges two
// knowledge sources keyed by `uploadId`: the client-owned `uploading` stage
// (browser→S3 PUT, unobservable by the server) and the server-authored stages
// (`queued`/`parsing`/`embedding`/`done`/`failed`) from the progress
// subscription. That merge lives here as a pure reducer — no React, no tRPC — so
// it is unit-tested standalone and the hook stays thin wiring.
//
// Divergence from chat's turn reducer: NO `stateRef`/intent triad. Nothing reads
// this state synchronously inside an async callback, so a plain
// `(state, event) => state` reducer over a flat `Record<uploadId, …>` suffices;
// `files`/`summary`/`completedJobIds` are pure per-render derivations.
import type { IngestStage } from '../api/schemas/ingest-progress-schema';

// Client-side Stage = the server wire stages ∪ the client-only `uploading`.
// Derived from the imported wire enum so the two can never drift.
export type Stage = IngestStage | 'uploading';

// A discriminated union on `stage`, mirroring the wire schema: `error` is REQUIRED
// on `failed` and unrepresentable otherwise, so the invariant is a type, not a
// comment. `fail()`/`reduceServerStage` narrow instead of leaning on a fallback.
interface PerFileBase {
  jobId: string;
  uploadId: string;
  filename: string;
}
export type PerFileProgress = PerFileBase &
  ({ stage: Exclude<Stage, 'failed'> } | { stage: 'failed'; error: string });

// Forward-only ranks (#180): a stage advances only to a STRICTLY greater rank, so
// a redelivered event on transient reconnect — or the optimistic-`queued` (client)
// vs real-`queued` (server) overlap — can never regress a row. `failed` is NOT
// ranked; it is an absorbing terminal handled explicitly (a failed Upload never
// re-enters the pipeline — a re-upload is a fresh `uploadId`). Exported so the
// view derives its progress-bar fill from this SAME ordering — no parallel table.
export const STAGE_RANK: Record<Exclude<Stage, 'failed'>, number> = {
  uploading: 0,
  queued: 1,
  parsing: 2,
  embedding: 3,
  done: 4,
};

export interface ProgressState {
  // Mount-owned per-Upload records, keyed by `uploadId`.
  byId: Record<string, PerFileProgress>;
  // Submission (presign) order — drives the rendered row order.
  order: string[];
}

export const initialProgressState: ProgressState = { byId: {}, order: [] };

// Events fed to the reducer. Local events are authored by this mount's upload
// flow (presign → PUT → enqueue); `serverStage` carries a progress-stream entry
// from the subscription.
export type ProgressEvent =
  // Presign resolved: seed one `uploading` record per file, in submission order.
  | {
      type: 'presigned';
      jobId: string;
      uploads: { uploadId: string; filename: string }[];
    }
  // A browser→S3 PUT rejected: that file fails independently (in-list, not toasted).
  | { type: 'putFailed'; uploadId: string; error: string }
  // startIngestJob resolved: optimistic `queued` for the enqueued Uploads.
  | { type: 'enqueued'; uploadIds: string[] }
  // startIngestJob rejected: fail the whole batch so PUT-succeeded files aren't
  // stranded at `uploading`.
  | { type: 'enqueueFailed'; uploadIds: string[]; error: string }
  // A server progress entry: advance-if-greater; an unknown `uploadId` (another
  // tab/mount, or already-torn-down) is a no-op. Discriminated like the wire so
  // `error` is required on `failed` and absent otherwise.
  | ({ type: 'serverStage'; uploadId: string } & (
      | { stage: Exclude<IngestStage, 'failed'> }
      | { stage: 'failed'; error: string }
    ));

// Advance a record to a forward stage: only if strictly greater. A record already
// at a terminal stage (`done`/`failed`) is absorbing and never changes.
function advance(
  record: PerFileProgress,
  stage: Exclude<Stage, 'failed'>,
): PerFileProgress {
  if (record.stage === 'done' || record.stage === 'failed') return record;
  if (STAGE_RANK[stage] > STAGE_RANK[record.stage]) return { ...record, stage };
  return record;
}

// Mark a record failed (absorbing). A record already terminal is left as-is: the
// first failure's error wins, and a stray failure after `done` is ignored.
function fail(record: PerFileProgress, error: string): PerFileProgress {
  if (record.stage === 'done' || record.stage === 'failed') return record;
  return { ...record, stage: 'failed', error };
}

// Apply a transform to each KNOWN record in `uploadIds`, skipping unknown ids;
// returns the same state reference when nothing changed (cheap render bailouts).
function applyToMany(
  state: ProgressState,
  uploadIds: string[],
  fn: (record: PerFileProgress) => PerFileProgress,
): ProgressState {
  let changed = false;
  const byId = { ...state.byId };
  for (const id of uploadIds) {
    const record = byId[id];
    if (!record) continue;
    const next = fn(record);
    if (next !== record) {
      byId[id] = next;
      changed = true;
    }
  }
  return changed ? { ...state, byId } : state;
}

// Replace one record by id, returning the same state reference when unchanged.
function replaceOne(
  state: ProgressState,
  uploadId: string,
  next: PerFileProgress,
): ProgressState {
  if (state.byId[uploadId] === next) return state;
  return { ...state, byId: { ...state.byId, [uploadId]: next } };
}

// Seed one `uploading` record per file (idempotent — a re-dispatched presign
// never duplicates a row), appended to `order` in submission order.
function reducePresigned(
  state: ProgressState,
  event: Extract<ProgressEvent, { type: 'presigned' }>,
): ProgressState {
  const byId = { ...state.byId };
  const added: string[] = [];
  for (const u of event.uploads) {
    if (byId[u.uploadId]) continue;
    byId[u.uploadId] = {
      jobId: event.jobId,
      uploadId: u.uploadId,
      filename: u.filename,
      stage: 'uploading',
    };
    added.push(u.uploadId);
  }
  if (added.length === 0) return state;
  return { byId, order: [...state.order, ...added] };
}

// Apply a server progress entry to a known record; an unknown uploadId is a no-op.
function reduceServerStage(
  state: ProgressState,
  event: Extract<ProgressEvent, { type: 'serverStage' }>,
): ProgressState {
  const record = state.byId[event.uploadId];
  if (!record) return state;
  const next =
    event.stage === 'failed'
      ? fail(record, event.error)
      : advance(record, event.stage);
  return replaceOne(state, event.uploadId, next);
}

export function ingestProgressReducer(
  state: ProgressState,
  event: ProgressEvent,
): ProgressState {
  switch (event.type) {
    case 'presigned': {
      return reducePresigned(state, event);
    }
    case 'putFailed': {
      const record = state.byId[event.uploadId];
      if (!record) return state;
      return replaceOne(state, event.uploadId, fail(record, event.error));
    }
    case 'enqueued': {
      return applyToMany(state, event.uploadIds, (r) => advance(r, 'queued'));
    }
    case 'enqueueFailed': {
      return applyToMany(state, event.uploadIds, (r) => fail(r, event.error));
    }
    case 'serverStage': {
      return reduceServerStage(state, event);
    }
  }
}

// ── Pure per-render derivations ─────────────────────────────────────────────

// Records in submission order (the reducer keeps `order` aligned to presign).
export function deriveFiles(state: ProgressState): PerFileProgress[] {
  return state.order
    .map((id) => state.byId[id])
    .filter((r): r is PerFileProgress => r !== undefined);
}

export interface ProgressSummary {
  total: number;
  succeeded: number;
  failed: number;
  inProgress: number;
  isComplete: boolean;
}

export function deriveSummary(files: PerFileProgress[]): ProgressSummary {
  const succeeded = files.filter((f) => f.stage === 'done').length;
  const failed = files.filter((f) => f.stage === 'failed').length;
  const total = files.length;
  const inProgress = total - succeeded - failed;
  return {
    total,
    succeeded,
    failed,
    inProgress,
    isComplete: total > 0 && inProgress === 0,
  };
}

const TERMINAL: ReadonlySet<Stage> = new Set(['done', 'failed']);

// The set of jobIds whose EVERY Upload has reached a terminal stage. Drives the
// single idempotent `documents.list` invalidation — completion is per-Job.
export function deriveCompletedJobIds(files: PerFileProgress[]): Set<string> {
  const byJob = new Map<string, PerFileProgress[]>();
  for (const f of files) {
    const list = byJob.get(f.jobId) ?? [];
    list.push(f);
    byJob.set(f.jobId, list);
  }
  const completed = new Set<string>();
  for (const [jobId, list] of byJob) {
    if (list.every((f) => TERMINAL.has(f.stage))) completed.add(jobId);
  }
  return completed;
}
