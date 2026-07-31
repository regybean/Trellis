'use client';

import { Check, FileText, Loader2, X } from 'lucide-react';

import { Badge, cn, Progress } from '@acme/ui';

import type {
  PerFileProgress,
  ProgressSummary,
  Stage,
} from '../hooks/ingest-progress-reducer';
import { useIngestUpload } from '../hooks/ingest-upload-context';

// Variant A — dense rows (#181). One line per Upload under a job summary strip:
// admin ingest is a batch operation (6+ files common), so density + a primary
// "is the whole batch done" signal beat per-file steppers/kanban.

// Per-file progress-bar fill: `RANK[stage] / 4`. `uploading`→`done` climb 0→4;
// `failed` renders a FULL bar in destructive (see the row), so it maps to 4 too.
const STAGE_RANK: Record<Stage, number> = {
  uploading: 0,
  queued: 1,
  parsing: 2,
  embedding: 3,
  done: 4,
  failed: 4,
};

const STAGE_LABEL: Record<Stage, string> = {
  uploading: 'Uploading',
  queued: 'Queued',
  parsing: 'Parsing',
  embedding: 'Embedding',
  done: 'Done',
  failed: 'Failed',
};

function stagePillVariant(stage: Stage) {
  if (stage === 'failed') return 'destructive' as const;
  if (stage === 'done') return 'default' as const;
  return 'secondary' as const;
}

function StagePill({ stage, className }: { stage: Stage; className?: string }) {
  const isActive = stage !== 'done' && stage !== 'failed';
  return (
    <Badge variant={stagePillVariant(stage)} className={cn('gap-1', className)}>
      {isActive && <Loader2 className="h-3 w-3 animate-spin" />}
      {stage === 'done' && <Check className="h-3 w-3" />}
      {stage === 'failed' && <X className="h-3 w-3" />}
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

/**
 * Pure presentational Variant A panel — driven entirely by `files` + `summary`
 * (hook-derived state). Kept prop-driven (no context) so it is directly testable
 * with synthetic state, the un-drivable SSE tail out of the way (ADR 0018).
 * Renders nothing until there is at least one Upload to show.
 */
export function IngestProgressView({
  files,
  summary,
}: {
  files: PerFileProgress[];
  summary: ProgressSummary;
}) {
  if (files.length === 0) return null;

  const overallPercent =
    summary.total === 0
      ? 0
      : ((summary.succeeded + summary.failed) / summary.total) * 100;

  return (
    <div className="border-border mb-4 overflow-hidden rounded-md border">
      {/* Job summary strip */}
      <div className="bg-muted/40 flex items-center justify-between gap-4 border-b px-4 py-2.5">
        <span className="text-sm font-medium">
          {summary.isComplete
            ? 'Ingest complete'
            : `Ingesting ${summary.inProgress} of ${summary.total}…`}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs tabular-nums">
            {summary.succeeded} done · {summary.failed} failed
          </span>
          <Progress value={overallPercent} className="h-1.5 w-32" />
        </div>
      </div>

      {/* Per-file rows */}
      <ul className="divide-border divide-y">
        {files.map((file) => (
          <li
            key={file.uploadId}
            className="flex items-center gap-3 px-4 py-2.5"
          >
            <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm">{file.filename}</p>
              {file.stage === 'failed' && (
                <p className="text-destructive truncate text-xs">
                  {file.error}
                </p>
              )}
            </div>
            <Progress
              value={(STAGE_RANK[file.stage] / 4) * 100}
              className={cn(
                'h-1.5 w-24',
                file.stage === 'failed' && '[&>*]:bg-destructive',
              )}
            />
            <StagePill stage={file.stage} className="w-24 justify-center" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The app-mounted panel: reads the shared upload state from context and renders
 * the pure view above the `DocumentsList`. Always-on while the documents section
 * (the `IngestUploadProvider`) is mounted.
 */
export function IngestProgress() {
  const { files, summary } = useIngestUpload();
  return <IngestProgressView files={files} summary={summary} />;
}
