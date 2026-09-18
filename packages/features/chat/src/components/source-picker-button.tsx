'use client';

import { Database } from 'lucide-react';

import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@acme/ui';

import type { RecordedSources } from '../api/schemas/message-source-schema';

/**
 * The composer's Data Source control: one `Database`-icon button immediately
 * left of the input, doing two jobs through two different interactions.
 *
 * **Hover reads, click edits.** Checking what the next message is grounded in
 * is the frequent act and must never cost a panel open, so the selected names
 * live in a tooltip. The panel is a management surface and is never how you
 * view current scope. That split is why this is a button with a tooltip rather
 * than a popover trigger.
 *
 * **No count, no chip rail, one exception.** A selected scope leaves the button
 * undecorated: the `n of M selected` count belongs in the panel header, and a
 * chip rail of names wraps onto several lines in a composer. The exception is
 * the EMPTY scope, which gets a small amber pip — empty means retrieve nothing,
 * it is both the default and sticky, and it is otherwise a silent failure mode
 * with no other trace in the composer.
 *
 * The names come from the selection (ultimately the per-Message receipt), never
 * from `dataSources.list` — invariant 11. This surface claims what the next
 * question will be exposed to, and the list is persisted, so it could name a
 * Source off a stale snapshot.
 */
export function SourcePickerButton({
  selected,
  isEmptyScope,
  isPanelOpen,
  onTogglePanel,
}: {
  selected: RecordedSources;
  isEmptyScope: boolean;
  isPanelOpen: boolean;
  onTogglePanel: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          onClick={onTogglePanel}
          aria-label="Data sources"
          aria-expanded={isPanelOpen}
          data-testid="source-picker-button"
          className="relative shrink-0"
        >
          <Database className="h-4 w-4" />
          {isEmptyScope && (
            // Decoration, so it is hidden from the accessibility tree — the
            // amber is not a channel a screen reader has. The same fact reaches
            // assistive tech as text, in the tooltip and the panel header.
            <span
              aria-hidden="true"
              data-testid="source-empty-pip"
              className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500"
            />
          )}
        </Button>
      </TooltipTrigger>

      <TooltipContent side="top" align="start" className="max-w-56">
        <p className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
          Data sources
        </p>

        {isEmptyScope ? (
          <p className="mt-1 text-amber-600 dark:text-amber-400">
            No sources selected
          </p>
        ) : (
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {selected.map((source) => (
              <li key={source.id} className="truncate">
                {source.name}
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground mt-1.5 text-[10px]">
          Click to edit
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
