'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';

import { cn } from '@acme/ui';

import type { RecordedSources } from '../api/schemas/message-source-schema';

/**
 * "Sources included" — what a settled assistant Message discloses about the
 * Data Sources its Turn was scoped to.
 *
 * **The label is `included`, never `used` and never `citations`.** The agent
 * decides whether to call the retrieval tool at all, so a Turn scoped to three
 * Sources may have read none of them; and which chunks actually grounded an
 * answer is a different feature that needs mid-stream tool-result capture. The
 * honest claim is what the Turn was allowed to see.
 *
 * **Names come from the per-Message receipt, never from `dataSources.list`**
 * (invariant 11). That is what makes this self-contained — it renders on a cold
 * open with no list fetched — and it is the only read that still tells the truth
 * once a Source has been renamed or hard-deleted, because the receipt stores the
 * name the Source had when the Turn settled.
 *
 * **Hover reveals, click expands, and expanded stays expanded.** Tying the list
 * to hover would let it vanish mid-read the moment the pointer drifted. So the
 * trigger is hover-revealed while collapsed, and once open both the trigger and
 * the list stay put regardless of the pointer.
 *
 * **It renders natively, not through `renderMessageActions`.** That slot exists
 * so chat never depends on a sibling feature ([ADR
 * 0007](../../docs/adr/0007-message-actions-render-slot.md)); routing chat's own
 * data out through a slot four apps fill, to hand it straight back to chat, buys
 * nothing and costs four wiring sites. It shares the row beneath the bubble with
 * whatever the slot supplies, sitting to its right.
 *
 * An **absent** receipt renders nothing — a pre-feature Message, or a Turn that
 * failed and wrote none. So does the **empty** receipt: an empty-scope Turn is
 * deliberately unexplained in the transcript, with the composer's amber pip as
 * the user's signal before they send rather than a "no sources" line after.
 */
export function MessageSources({ sources }: { sources: RecordedSources }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        data-testid="message-sources-trigger"
        className={cn(
          'text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-opacity',
          // Revealed by the pointer, but only while there is nothing open to
          // lose. Focus reveals it too, so it is reachable without a pointer.
          isExpanded
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        <Database className="h-3 w-3" />
        <span>
          {sources.length} source{sources.length === 1 ? '' : 's'} included
        </span>
        {isExpanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>

      {isExpanded && (
        <ul
          data-testid="message-sources-list"
          className="text-muted-foreground mt-1 list-inside list-disc space-y-0.5 text-xs"
        >
          {sources.map((source) => (
            <li key={source.id} className="truncate">
              {source.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
