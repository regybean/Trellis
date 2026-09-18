import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import type {
  RecordedSource,
  RecordedSources,
} from '../api/schemas/message-source-schema';
import { usePersistedQueryOptions, useTRPC } from '../trpc/react';

/**
 * A checkbox row in the composer panel: the Source, and what it holds.
 *
 * `documentCount` is `undefined` while the count query is in flight rather
 * than `0`, so the panel omits the number instead of telling the user a Source
 * is empty when it may be full. The distinction matters here more than it does
 * on the documents page: this number is the main thing a user weighs when
 * deciding whether ticking a Source is worth it.
 */
export interface SourceRow {
  id: string;
  name: string;
  documentCount: number | undefined;
}

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
  const queryClient = useQueryClient();
  const persisted = usePersistedQueryOptions();

  // The caller's own Sources — the panel's rows, and the set membership is
  // reconciled against. Persisted, so the panel is populated on a cold open.
  const sourcesQuery = useQuery(
    trpc.chat.dataSources.list.queryOptions(undefined, persisted),
  );

  // The per-Source Document counts the panel rows show. Deliberately NOT
  // persisted alongside the list: the count is the one field on a row that goes
  // stale within a session, and a restored snapshot would paint yesterday's
  // number beside today's name. It is advisory either way — it tells the user
  // which Source is worth ticking, never what a Turn may retrieve.
  const countsQuery = useQuery(
    trpc.chat.dataSources.documentCounts.queryOptions(),
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

  // A Source holding nothing has no row in the roll-up, so the zero is supplied
  // here rather than by the procedure — but only once the count query has
  // actually settled. Before that every Source reads `undefined` and the panel
  // omits the number, instead of labelling a full Source empty for the duration
  // of the first fetch.
  const counts = new Map(
    (countsQuery.data ?? []).map((row) => [
      row.dataSourceId,
      row.documentCount,
    ]),
  );
  const documentCount = (id: string) =>
    countsQuery.isSuccess ? (counts.get(id) ?? 0) : undefined;

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

  // The id is minted here so a retry reconciles 1:1 with the row it already
  // made rather than leaving two Sources of the same name; safe only because
  // the retrieval filter's first clause is the verified owner. No optimistic
  // insert, for the reason ingest's create gives: the row a name collision must
  // not produce is exactly a row that appeared before the server accepted it.
  //
  // A create failure is a toast rather than an inline field error. The
  // client-side collision check that earns an inline message needs the owned
  // list as its rule, and that lives on the documents page where the user is
  // actually managing Sources; here the create is a convenience on the way to
  // uploading, and the cap is the likelier refusal of the two.
  const create = useMutation(
    trpc.chat.dataSources.create.mutationOptions({
      onSuccess: (created) => {
        void queryClient.invalidateQueries(
          trpc.chat.dataSources.list.pathFilter(),
        );
        // Tick it. The user opened the panel to change what the next message is
        // grounded in, so a Source that arrives unticked is a second click for
        // the thing they already asked for — and it holds no Documents yet, so
        // ticking it widens the scope by nothing.
        toggle(created);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return {
    /**
     * The panel's rows, each with what it holds.
     *
     * Names come from here, and ONLY the panel may use them: it is the one
     * Source surface that states what you could pick rather than what a
     * question was exposed to. Every surface making the latter claim — the
     * composer tooltip, "Sources included" — reads names off the per-Message
     * receipt instead, because this list is persisted (invariant 11).
     */
    sources: (owned ?? []).map<SourceRow>(({ id, name }) => ({
      id,
      name,
      documentCount: documentCount(id),
    })),
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
    /** Inline create from the panel. Ticks what it makes. */
    createSource: (name: string) =>
      create.mutateAsync({ id: crypto.randomUUID(), name }),
    isCreating: create.isPending,
    /**
     * One Message's receipt — the Sources that Turn was scoped to, under the
     * names they had — or `undefined` for a Message with no receipt at all
     * (a pre-feature Message, or a Turn that failed).
     *
     * This is what "Sources included" renders, and the reason it takes a
     * `messageId` rather than resolving ids against `sources`: the receipt is
     * the only read that still tells the truth once a Source has been renamed
     * or hard-deleted. `undefined` and `[]` are different answers — the empty
     * collection means "asked with no Sources", which the transcript discloses.
     */
    sourcesForMessage: (messageId: string) =>
      recordsQuery.data?.find((record) => record.messageId === messageId)
        ?.sources,
  };
}
