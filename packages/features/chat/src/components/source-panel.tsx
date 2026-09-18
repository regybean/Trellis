'use client';

import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';

import { Button, Checkbox, cn, Input, Skeleton } from '@acme/ui';

import type { RecordedSource } from '../api/schemas/message-source-schema';
import type { SourceRow } from '../hooks/use-source-selection';

/**
 * The composer picker's management surface: a 16rem right-hand panel listing
 * the caller's Data Sources as checkbox rows.
 *
 * **It is never how you view current scope.** That is the tooltip's job, and
 * the whole reason this is a panel you open rather than a rail that is always
 * there. Rejected alternatives, all of which conflate the two jobs: a chip rail
 * in the composer (wraps onto several lines), a conversation-level scope bar
 * (puts scope far from the act of sending), and a permanent right rail (owns
 * 16rem forever to answer a question a hover answers).
 *
 * **Nothing here locks while a Turn is in flight.** The header says what the
 * edit applies to instead. A disabled picker would be the wrong answer to a
 * real confusion: the user is reading a streaming answer and deciding what the
 * NEXT question should see, which is exactly when they want to change it.
 *
 * The name filter is local state and nothing else is. Membership, the counts
 * and the empty-scope flag are all the selection hook's, derived per render, so
 * a Source deleted elsewhere leaves this list the moment `dataSources.list`
 * settles rather than after an effect has noticed.
 *
 * This is the one Source surface allowed to render names from
 * `dataSources.list`: it states what you COULD pick, not what a question was
 * exposed to, so a name from a stale snapshot is cosmetic here (invariant 11).
 */
export function SourcePanel({
  sources,
  isSelected,
  selectedCount,
  isEmptyScope,
  hasNoSources,
  isLoading,
  isTurnInFlight,
  onToggle,
  onSelectAll,
  onClear,
  onCreate,
  isCreating,
  documentsPath,
  onClose,
}: {
  sources: SourceRow[];
  isSelected: (id: string) => boolean;
  selectedCount: number;
  isEmptyScope: boolean;
  hasNoSources: boolean;
  isLoading: boolean;
  isTurnInFlight: boolean;
  onToggle: (source: RecordedSource) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onCreate: (name: string) => Promise<unknown>;
  isCreating: boolean;
  documentsPath: string;
  onClose: () => void;
}) {
  return (
    <aside
      // 16rem, fixed. The cap of ten Sources is what makes a fixed-width
      // scrolling list the whole answer to "how does this read at twenty".
      className="bg-background flex w-64 shrink-0 flex-col border-l"
      aria-label="Data sources"
      data-testid="source-panel"
    >
      <PanelHeader
        selectedCount={selectedCount}
        total={sources.length}
        isEmptyScope={isEmptyScope}
        isTurnInFlight={isTurnInFlight}
        onClose={onClose}
      />

      {hasNoSources ? (
        <NoSourcesYet documentsPath={documentsPath} />
      ) : (
        <SourceChooser
          sources={sources}
          isSelected={isSelected}
          isLoading={isLoading}
          onToggle={onToggle}
          onSelectAll={onSelectAll}
          onClear={onClear}
          onCreate={onCreate}
          isCreating={isCreating}
        />
      )}
    </aside>
  );
}

/**
 * Title, scope line, and the in-flight note.
 *
 * The `n of M selected` count lives here and nowhere else, which is what lets
 * the composer button stay undecorated. Empty is the one state said in words
 * and in amber, because it means retrieve nothing.
 */
function PanelHeader({
  selectedCount,
  total,
  isEmptyScope,
  isTurnInFlight,
  onClose,
}: {
  selectedCount: number;
  total: number;
  isEmptyScope: boolean;
  isTurnInFlight: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b p-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Data sources</h2>

        <p
          className={cn(
            'mt-0.5 text-xs tabular-nums',
            isEmptyScope
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground',
          )}
          data-testid="source-panel-scope"
        >
          {isEmptyScope
            ? 'No sources selected'
            : `${selectedCount} of ${total} selected`}
        </p>

        {/* Not a warning and not a lock — a statement of when the edit lands.
            The selection is per-Turn, so an in-flight Turn already has its
            scope and nothing here can change it. */}
        {isTurnInFlight && (
          <p className="text-muted-foreground mt-1 text-[11px] italic">
            applies from your next message
          </p>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClose}
        aria-label="Close data sources"
        className="h-6 w-6 shrink-0 p-0"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * The filter, the checkbox rows and the bulk actions — the picking half.
 *
 * The filter text is the only state in this whole panel, and it lives here
 * rather than a level up because nothing above it reads the filtered list.
 */
function SourceChooser({
  sources,
  isSelected,
  isLoading,
  onToggle,
  onSelectAll,
  onClear,
  onCreate,
  isCreating,
}: {
  sources: SourceRow[];
  isSelected: (id: string) => boolean;
  isLoading: boolean;
  onToggle: (source: RecordedSource) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onCreate: (name: string) => Promise<unknown>;
  isCreating: boolean;
}) {
  const [filter, setFilter] = useState('');

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? sources.filter((source) => source.name.toLowerCase().includes(needle))
    : sources;

  return (
    <>
      <div className="p-3 pb-2">
        <Input
          value={filter}
          onChange={(evt) => setFilter(evt.target.value)}
          placeholder="Filter by name"
          aria-label="Filter data sources by name"
          className="h-8"
          data-testid="source-filter"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
        {isLoading && (
          <div className="space-y-2 px-1 py-1">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
          </div>
        )}

        {visible.map((source) => (
          <SourceCheckboxRow
            key={source.id}
            source={source}
            isSelected={isSelected(source.id)}
            onToggle={() => onToggle({ id: source.id, name: source.name })}
          />
        ))}

        {!isLoading && visible.length === 0 && (
          <p className="text-muted-foreground px-2 py-3 text-xs">
            No data source matches &ldquo;{filter.trim()}&rdquo;.
          </p>
        )}
      </div>

      <div className="space-y-1 border-t p-2">
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSelectAll}
            className="text-muted-foreground flex-1 text-xs"
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-muted-foreground flex-1 text-xs"
          >
            Clear
          </Button>
        </div>

        <InlineCreateRow onCreate={onCreate} isCreating={isCreating} />
      </div>
    </>
  );
}

/**
 * Zero Sources exist at all. Says what the consequence is rather than just that
 * the list is empty, because "no data sources" alone does not tell the user
 * their answers are ungrounded.
 *
 * The action is an ordinary link to the app's documents route, not an upload
 * control: upload belongs to `@acme/ingest`, and chat naming a sibling
 * feature's component would be the features→features edge the slice contract
 * exists to prevent. The path is the app's to supply.
 */
function NoSourcesYet({ documentsPath }: { documentsPath: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3 p-4 text-center">
      <p className="text-muted-foreground text-xs">
        You have no data sources yet. Answers will not use your documents.
      </p>
      <Button asChild variant="outline" size="sm">
        <a href={documentsPath}>Upload documents</a>
      </Button>
    </div>
  );
}

function SourceCheckboxRow({
  source,
  isSelected,
  onToggle,
}: {
  source: SourceRow;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        isSelected ? 'bg-accent/60' : 'hover:bg-accent/40',
      )}
    >
      <Checkbox checked={isSelected} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{source.name}</span>

      {/* Omitted, not zeroed, while the count query is in flight: a Source
          labelled empty when it is full would steer the tick the wrong way. */}
      {source.documentCount !== undefined && (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {source.documentCount}
        </span>
      )}
    </label>
  );
}

/**
 * Inline create, as a row rather than a dialog — a modal for one text field
 * would cover the list the user is naming against.
 *
 * **No client-side collision check here, deliberately**, unlike the documents
 * page. The name-folding rule would have to be written a second time in a
 * second feature to get one, and two expressions of the same rule is the drift
 * this spec's ownership decisions exist to avoid. rag's unique index still
 * refuses a duplicate, and it arrives as a toast — the same channel the per-user
 * cap refusal already uses, which is the likelier of the two refusals from here.
 * The documents page is where Sources are managed and where the inline message
 * is worth its duplication; this is a shortcut on the way to uploading.
 *
 * A blank draft is an abandonment rather than a validation failure: there is
 * nothing to fix and nothing to tell the user.
 */
function InlineCreateRow({
  onCreate,
  isCreating,
}: {
  onCreate: (name: string) => Promise<unknown>;
  isCreating: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const close = () => setDraft(null);

  const commit = () => {
    const name = draft?.trim() ?? '';
    if (name.length === 0) {
      close();
      return;
    }
    close();
    void onCreate(name);
  };

  if (draft === null) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setDraft('')}
        disabled={isCreating}
        className="text-muted-foreground w-full justify-start gap-2 text-xs"
        data-testid="source-create-open"
      >
        <Plus className="h-3.5 w-3.5" />
        New data source
      </Button>
    );
  }

  return (
    <div ref={rowRef} className="px-1">
      <Input
        autoFocus
        value={draft}
        disabled={isCreating}
        aria-label="New data source name"
        // A placeholder, never a prefill: a field arriving pre-filled gets
        // accepted unread, and the partition ends up on paper only.
        placeholder="e.g. Work notes"
        onChange={(evt) => setDraft(evt.target.value)}
        onKeyDown={(evt) => {
          if (evt.key === 'Enter') commit();
          if (evt.key === 'Escape') close();
        }}
        // Commit on blur as well as Enter — the row IS the field, so clicking
        // away is a finish. Moving to another control in this footer is the
        // exception: reaching for `Clear` is that action, not a finish, and
        // creating a Source out of it would be a create nobody asked for.
        onBlur={(evt) => {
          const movedTo = evt.relatedTarget;
          if (movedTo instanceof Node && rowRef.current?.contains(movedTo)) {
            return;
          }
          commit();
        }}
        className="h-8"
        data-testid="source-create-input"
      />
    </div>
  );
}
