'use client';

import { useRef, useState } from 'react';
import { revalidateLogic, useForm } from '@tanstack/react-form';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { Button, cn, firstErrorMessage, Input } from '@acme/ui';

import type { DataSourceSummary } from '../hooks/use-documents-page';
import { dataSourceNameSchema } from '../lib/data-source-validation';

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
  atCap,
  onCreate,
  isCreating,
  onDelete,
}: {
  sources: DataSourceSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  totalDocumentCount: number;
  maxDataSourcesPerUser: number | undefined;
  atCap: boolean;
  onCreate: (name: string) => Promise<{ id: string } | undefined>;
  isCreating: boolean;
  onDelete: (source: DataSourceSummary) => void;
}) {
  // Whether the create row is open, and nothing else: the draft name and its
  // collision error are the form's, so this is the one thing left that is not
  // derivable — clicking `＋ New data source` opens an empty, autofocused
  // field, which is a state an empty string cannot distinguish from closed.
  const [isNaming, setIsNaming] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  // Validate on submit, then on every keystroke after the first attempt — so a
  // collision surfaces when the user commits and clears itself as they fix the
  // name, without nagging about a blank field they are still filling in.
  const form = useForm({
    defaultValues: { name: '' },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({ name: dataSourceNameSchema(sources) }),
    },
    onSubmit: async ({ value, formApi }) => {
      const created = await onCreate(value.name.trim());
      setIsNaming(false);
      formApi.reset();
      // Land in the Source you just made; a create that failed leaves you put.
      if (created) onSelect(created.id);
    },
  });

  const closeNaming = () => {
    setIsNaming(false);
    form.reset();
  };

  const commit = () => {
    // An empty draft is an abandonment, not a validation failure: there is
    // nothing to fix and nothing to tell the user about.
    if (form.state.values.name.trim().length === 0) {
      closeNaming();
      return;
    }
    void form.handleSubmit();
  };

  return (
    <div ref={railRef} className="w-60 shrink-0 space-y-1">
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
        // A plain row, not a `<form>`: one field with no submit control, so
        // Enter is the commit and there is no implicit submission to route it
        // through. TanStack Form owns the value and the validation either way.
        <div className="px-2 py-1">
          <form.Field name="name">
            {(field) => {
              const error = firstErrorMessage(field.state.meta.errors);
              return (
                <>
                  <Input
                    autoFocus
                    aria-label="New data source name"
                    // A placeholder, never a prefill: a field arriving
                    // pre-filled with "My Documents" gets accepted unread, and
                    // the partition ends up on paper only.
                    placeholder="e.g. Work notes"
                    value={field.state.value}
                    disabled={isCreating}
                    onChange={(evt) => field.handleChange(evt.target.value)}
                    onKeyDown={(evt) => {
                      if (evt.key === 'Enter') commit();
                      if (evt.key === 'Escape') closeNaming();
                    }}
                    // Commit on blur as well as Enter — the row is the field, so
                    // clicking away is a finish, not an abandonment. Clicking
                    // ANOTHER rail control is the exception: reaching for a
                    // row's trash or switching Source is that action, not a
                    // finish, and creating a Source out of it would be a create
                    // the user never asked for. The draft stays open and
                    // uncommitted instead, so nothing typed is lost either.
                    onBlur={(evt) => {
                      field.handleBlur();
                      const movedTo = evt.relatedTarget;
                      if (
                        movedTo instanceof Node &&
                        railRef.current?.contains(movedTo)
                      ) {
                        return;
                      }
                      commit();
                    }}
                    className="h-8"
                  />
                  {error && (
                    <p role="alert" className="text-destructive mt-1 text-xs">
                      {error}
                    </p>
                  )}
                </>
              );
            }}
          </form.Field>
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
