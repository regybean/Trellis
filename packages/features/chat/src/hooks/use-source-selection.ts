import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type {
  RecordedSource,
  RecordedSources,
} from '../api/schemas/message-source-schema';
import { usePersistedQueryOptions, useTRPC } from '../trpc/react';

/**
 * The composer's Source Selection, and the stickiness that carries it forward.
 *
 * "Per-Turn" governs where the selection is VALIDATED — at every `chat.send`,
 * never read off the thread by the worker. It does not govern where the
 * selection is reset: a picker that emptied itself after every send would be
 * unusable. So:
 *
 * - A new Conversation starts with nothing selected.
 * - Within a Conversation the selection carries forward from the previous Turn.
 * - **The empty set carries forward too.** Deliberately unticking everything
 *   has to stay unticked, or turning grounding off does not stay off.
 * - On a fresh mount the selection derives from the latest per-Message record
 *   for the thread, not from client state — which would snap the picker to
 *   empty mid-conversation and read as a bug.
 *
 * Deliberately NOT stored on thread metadata the way `folderId` is. That would
 * be a second write path holding a privacy-relevant value, and one the worker
 * must not trust.
 *
 * ## One piece of state, and the reconciliation falls out of it
 *
 * The only state here is `edited`: the set the user has touched this mount, or
 * `null` for "untouched, so derive from the record". Everything else is
 * computed during render, and that is what makes the intersect-with-owned
 * reconciliation correct by construction rather than by an effect that has to
 * fire at the right moment. A Source deleted on another device unticks itself
 * the moment `dataSources.list` settles, because the render simply stops
 * finding it — there is no "when the query settles, go and fix the state" step
 * to miss.
 *
 * ## Where the names come from, and where they must not
 *
 * The selection carries each Source's name, not just its id, because the
 * composer tooltip lists them and must do so on a cold open before any list has
 * been fetched. Restored entries take their name from the RECORD; entries the
 * user ticks take it from the row they just read in the panel.
 *
 * What the list is used for is EXISTENCE, never names. That asymmetry is the
 * point: `dataSources.list` is persisted, so a surface asserting what a question
 * was exposed to could otherwise render a name off a stale cache. The
 * consequence, accepted: a Source renamed elsewhere shows its old name in the
 * tooltip until the user re-ticks it. Rename is rare and the id is what scopes
 * retrieval.
 *
 * ## Consumer contract
 *
 * Mount this under a component keyed by Conversation, so switching Conversation
 * remounts and `edited` starts as `null` again. That is the same assumption
 * `useChat` already makes, and it is why there is no effect here watching
 * `conversationId`.
 */
export function useSourceSelection(conversationId: string) {
  const trpc = useTRPC();
  const persisted = usePersistedQueryOptions();

  // The caller's own Sources — the panel's rows, and the set membership is
  // reconciled against. Persisted, so the panel is populated on a cold open.
  const sourcesQuery = useQuery(
    trpc.chat.dataSources.list.queryOptions(undefined, persisted),
  );

  // The Conversation's per-Message receipts, oldest first. Volatile rather than
  // persisted: this is the read the sticky set derives from, and a selection
  // restored from a stale snapshot is the one client-state error that would
  // silently WIDEN what the user believes their next question is exposed to.
  const recordsQuery = useQuery(
    trpc.chat.dataSources.records.queryOptions({ conversationId }),
  );

  const [edited, setEdited] = useState<RecordedSources | null>(null);

  // The latest settled Turn's Sources. Absent records mean a Conversation with
  // no Turn yet, which is the empty selection — and so is a record whose
  // `sources` is empty. The two are indistinguishable HERE on purpose; what the
  // distinction buys is on the server, where a failed Turn writes no row at all
  // and this therefore reads through to the previous settled one.
  const restored = recordsQuery.data?.at(-1)?.sources ?? [];
  const chosen = edited ?? restored;

  const owned = sourcesQuery.data;

  // Intersect with what the caller still owns — but only once the list has
  // actually settled. Filtering against an undefined list would untick
  // everything for the duration of the first fetch, which looks exactly like
  // the scope having been turned off.
  const selected = owned
    ? chosen.filter((source) => owned.some(({ id }) => id === source.id))
    : chosen;

  const isSelected = (id: string) =>
    selected.some((source) => source.id === id);

  // Toggling works from `selected`, not `chosen`: a ghost that the
  // reconciliation has already dropped must not come back because the user
  // happened to tick something else.
  const toggle = ({ id, name }: RecordedSource) => {
    setEdited(
      isSelected(id)
        ? selected.filter((source) => source.id !== id)
        : [...selected, { id, name }],
    );
  };

  const selectAll = () => {
    setEdited((owned ?? []).map(({ id, name }) => ({ id, name })));
  };

  // `[]`, never `null`: clearing is a choice that has to carry forward, and
  // `null` would mean "untouched" and snap straight back to the record.
  const clear = () => setEdited([]);

  return {
    /** The panel's rows. */
    sources: owned ?? [],
    /** The current selection, with the names the tooltip renders. */
    selected,
    /** What `chat.send` takes. */
    selectedIds: selected.map((source) => source.id),
    isSelected,
    /**
     * Empty means retrieve nothing, which is a silent failure mode otherwise —
     * so the composer marks it with an amber pip rather than leaving it to be
     * inferred from an absence.
     */
    isEmptyScope: selected.length === 0,
    /** The caller owns no Sources at all, which is the panel's empty state. */
    hasNoSources: sourcesQuery.isSuccess && (owned?.length ?? 0) === 0,
    isLoadingSources: sourcesQuery.isPending,
    toggle,
    selectAll,
    clear,
  };
}
