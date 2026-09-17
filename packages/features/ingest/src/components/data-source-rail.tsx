'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import { Button, cn, Input } from '@acme/ui';

import type { DataSourceSummary } from '../hooks/use-documents-page';
import {
  collisionMessage,
  findNameCollision,
} from '../lib/data-source-validation';

/**
 * The master half of the documents page: the user's Data Sources, one row each,
 * plus an `All documents` roll-up row.
 *
 * A Data Source is a place you stand, not a column you filter — which is why
 * this is a rail and not a facet on a flat table. The Source IS the privacy
 * boundary, and a filter chip reads as an attribute of the documents rather
 * than the partition they live in.
 *
 * Three things the rail carries that nothing else can:
 *
 * - `N/10` in the header. The cap is advisory here (presign is authoritative),
 *   but it is the only place the user learns the ceiling exists before hitting
 *   it, so `+ New data source` disables at the cap rather than failing on submit.
 * - A spinner in place of a row's document count while a batch is landing in
 *   it. The progress panel is scoped to the Source you are standing in, so this
 *   is the ONLY trace of an in-flight batch from anywhere else on the page —
 *   without it, navigating away from the destination would lose the batch.
 * - A hover-revealed trash whose friction depends on the row. The confirm is
 *   the caller's to raise (`onDelete` hands back the row), because only the
 *   page knows whether the Source still has Documents.
 *
 * Inline create is a rail row, not a dialog: `＋ New data source` swaps into a
 * text input that commits on Enter or blur. A dialog for one text field would
 * be a modal the user has to dismiss to see the list they are naming against.
 */
export function DataSourceRail({
  sources,
  selectedId,
  onSelect,
  totalDocumentCount,
  maxDataSourcesPerUser,
  onCreate,
  isCreating,
  onDelete,
}: {
  sources: DataSourceSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  totalDocumentCount: number;
  maxDataSourcesPerUser: number | undefined;
  onCreate: (name: string) => Promise<{ id: string } | undefined>;
  isCreating: boolean;
  onDelete: (source: DataSourceSummary) => void;
}) {
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // At the cap only when the cap is actually known. While it is in flight the
  // control stays live: an advisory check that guesses is worse than one that
  // waits, and presign rejects the batch either way.
  const atCap =
    maxDataSourcesPerUser !== undefined &&
    sources.length >= maxDataSourcesPerUser;

  const closeNaming = () => {
    setIsNaming(false);
    setName('');
    setError(null);
  };

  const commit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      closeNaming();
      return;
    }

    // Reject, never absorb. The collision has to surface beside the field
    // before the mutation fires, because landing the user's documents in a
    // Source they did not knowingly pick — one that may already be ticked in an
    // open conversation — is the one failure this page must not have.
    const clash = findNameCollision(sources, trimmed);
    if (clash) {
      setError(collisionMessage(clash.name));
      return;
    }

    const created = await onCreate(trimmed);
    closeNaming();
    // Land in the Source you just made; a create that failed leaves you put.
    if (created) onSelect(created.id);
  };

  return (
    <div className="w-60 shrink-0 space-y-1">
      <div className="mb-2 flex items-baseline justify-between px-2">
        <h2 className="text-sm font-semibold">Data sources</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {maxDataSourcesPerUser === undefined
            ? sources.length
            : `${sources.length}/${maxDataSourcesPerUser}`}
        </span>
      </div>

      <RailRow
        label="All documents"
        count={totalDocumentCount}
        isSelected={selectedId === null}
        onSelect={() => onSelect(null)}
      />

      {sources.map((source) => (
        <RailRow
          key={source.id}
          label={source.name}
          count={source.documentCount}
          isBusy={source.hasUploadInFlight}
          isSelected={selectedId === source.id}
          onSelect={() => onSelect(source.id)}
          onDelete={() => onDelete(source)}
        />
      ))}

      {isNaming ? (
        <div className="px-2 py-1">
          <Input
            autoFocus
            aria-label="New data source name"
            // A placeholder, never a prefill: a field arriving pre-filled with
            // "My Documents" gets accepted unread, and the partition ends up on
            // paper only.
            placeholder="e.g. Work notes"
            value={name}
            disabled={isCreating}
            onChange={(evt) => {
              setName(evt.target.value);
              setError(null);
            }}
            onKeyDown={(evt) => {
              if (evt.key === 'Enter') void commit();
              if (evt.key === 'Escape') closeNaming();
            }}
            // Commit on blur as well as Enter — the row is the field, so
            // clicking away is a finish, not an abandonment. A collision error
            // is the exception: blurring on it would discard the name the user
            // still has to fix.
            onBlur={() => {
              if (!error) void commit();
            }}
            className="h-8"
          />
          {error && (
            <p role="alert" className="text-destructive mt-1 text-xs">
              {error}
            </p>
          )}
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={atCap}
          onClick={() => setIsNaming(true)}
          className="text-muted-foreground w-full justify-start gap-2"
        >
          <Plus className="h-4 w-4" />
          New data source
        </Button>
      )}
    </div>
  );
}

function RailRow({
  label,
  count,
  isBusy,
  isSelected,
  onSelect,
  onDelete,
}: {
  label: string;
  count: number;
  isBusy?: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md pr-1',
        isSelected ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={isSelected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left text-sm"
      >
        <span className="truncate">{label}</span>
        {isBusy ? (
          <>
            <Loader2 className="text-muted-foreground h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="sr-only">Upload in progress</span>
          </>
        ) : (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {count}
          </span>
        )}
      </button>
      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="sr-only">Delete data source {label}</span>
        </Button>
      )}
    </div>
  );
}
