/**
 * useSourceSelection — integration/hooks.
 *
 * The sticky Source Selection, driven directly: real hook, real QueryClient,
 * MSW at the HTTP boundary, assertions on returned state.
 *
 * Frontend tests in this feature prove no privacy — a picker that offers an
 * unowned Source is harmless, because `chat.send` drops it and the retrieval
 * filter would exclude it anyway. Two claims here are the exception, and they
 * are why this file exists rather than being folded into a component test:
 *
 * 1. **Restore, including the empty set.** This is the one piece of client
 *    state whose wrongness silently WIDENS what the user believes their next
 *    question is exposed to. A restore bug that fell back to "all Sources"
 *    ticks boxes the user never ticked, and nothing in the DOM says so.
 * 2. **Reconciliation when the Source list settles.** It is the only
 *    user-visible trace of cache staleness in chat, and the list is persisted,
 *    so a ghost can outlive the Source it names.
 *
 * Deliberately NOT attempted: proving the selected set reached `chat.send` by
 * reading the MSW request body. Every handler in this repo is input-blind, and
 * that proof belongs on the backend, where the job payload carries the
 * validated set.
 */
import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SelectDataSource } from '@acme/rag/schema';

import type { MessageSources } from '../../../../api/schemas/message-source-schema';
import { useSourceSelection } from '../../../../hooks/use-source-selection';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const CONVERSATION = '99999999-9999-4999-8999-999999999999';
const WORK = '11111111-1111-4111-8111-111111111111';
const TAX = '22222222-2222-4222-8222-222222222222';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const source = (id: string, name: string): SelectDataSource => ({
  id,
  ownerId: 'user_test',
  name,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

// A settled Turn's receipt. `sources` carries names as well as ids, which is
// what lets the tooltip render on a cold open with no list fetched.
const receipt = (
  messageId: string,
  sources: { id: string; name: string }[],
): MessageSources => ({ messageId, sources });

const WORK_SOURCE = source(WORK, 'Work notes');
const TAX_SOURCE = source(TAX, 'Tax');
const WORK_PICK = { id: WORK, name: 'Work notes' };
const TAX_PICK = { id: TAX, name: 'Tax' };

// The hook plus the app's QueryClient, so a test can land a background refetch
// the way the browser does — an invalidation — rather than reaching into the
// hook.
const renderSelection = () =>
  renderHook(
    () => ({
      selection: useSourceSelection(CONVERSATION),
      queryClient: useQueryClient(),
    }),
    { wrapper: Providers },
  );

// ── Restore ──────────────────────────────────────────────────────────────────
describe('useSourceSelection – restore on a fresh mount', () => {
  it('ticks the Sources named by the latest record, with their names', async () => {
    server.use(
      trpcMsw.chat.dataSources.list.query(() => [WORK_SOURCE, TAX_SOURCE]),
      trpcMsw.chat.dataSources.records.query(() => [
        receipt('m1', [TAX_PICK]),
        receipt('m2', [WORK_PICK, TAX_PICK]),
      ]),
    );

    const { result } = renderSelection();

    // The LATEST record, not the first and not the union of them: stickiness
    // carries the previous Turn forward, so an older Turn's wider scope must
    // not creep back in.
    await waitFor(() =>
      expect(result.current.selection.selected).toEqual([WORK_PICK, TAX_PICK]),
    );
    expect(result.current.selection.isEmptyScope).toBe(false);
  });

  it('ticks nothing when the latest record is the empty set', async () => {
    server.use(
      trpcMsw.chat.dataSources.list.query(() => [WORK_SOURCE, TAX_SOURCE]),
      trpcMsw.chat.dataSources.records.query(() => [
        receipt('m1', [WORK_PICK]),
        receipt('m2', []),
      ]),
    );

    const { result } = renderSelection();

    // The load-bearing case. Deliberately unticking everything has to survive a
    // remount, and a restore that fell back to "all Sources" would tick both of
    // these with nothing in the DOM to say it had. So the assertion is the
    // whole list is empty while a non-empty list is sitting right there, ready
    // to be wrongly adopted.
    await waitFor(() =>
      expect(result.current.selection.sources).toHaveLength(2),
    );
    expect(result.current.selection.selected).toEqual([]);
    expect(result.current.selection.isEmptyScope).toBe(true);
  });

  it('ticks nothing for a Conversation with no Turn yet', async () => {
    server.use(
      trpcMsw.chat.dataSources.list.query(() => [WORK_SOURCE]),
      trpcMsw.chat.dataSources.records.query(() => []),
    );

    const { result } = renderSelection();

    await waitFor(() =>
      expect(result.current.selection.sources).toHaveLength(1),
    );
    // A new Conversation starts empty. Same observable state as the empty
    // record above, and that is fine on the client — the distinction the two
    // shapes buy is on the server, where a failed Turn writes no row and so
    // reads through to the previous settled one.
    expect(result.current.selection.selected).toEqual([]);
  });

  it('keeps a cleared selection instead of snapping back to the record', async () => {
    server.use(
      trpcMsw.chat.dataSources.list.query(() => [WORK_SOURCE]),
      trpcMsw.chat.dataSources.records.query(() => [
        receipt('m1', [WORK_PICK]),
      ]),
    );

    const { result } = renderSelection();
    await waitFor(() =>
      expect(result.current.selection.selected).toEqual([WORK_PICK]),
    );

    act(() => result.current.selection.clear());

    // Clearing is a choice, not an absence of one — if it read as "untouched"
    // the derivation would restore the record on the next render and turning
    // grounding off would not stay off.
    expect(result.current.selection.selected).toEqual([]);
    expect(result.current.selection.isEmptyScope).toBe(true);
  });
});

// ── Reconciliation ───────────────────────────────────────────────────────────
describe('useSourceSelection – reconciliation with the owned list', () => {
  it('unticks a Source deleted elsewhere when the list settles again', async () => {
    let listCalls = 0;
    server.use(
      trpcMsw.chat.dataSources.list.query(() => {
        listCalls += 1;
        // Deleted on another device between the two reads.
        return listCalls === 1 ? [WORK_SOURCE, TAX_SOURCE] : [TAX_SOURCE];
      }),
      trpcMsw.chat.dataSources.records.query(() => [
        receipt('m1', [WORK_PICK, TAX_PICK]),
      ]),
    );

    const { result } = renderSelection();
    await waitFor(() =>
      expect(result.current.selection.selected).toEqual([WORK_PICK, TAX_PICK]),
    );

    await act(async () => {
      await result.current.queryClient.invalidateQueries();
    });

    // The reconciliation is the render, not an effect: the moment the list
    // comes back without WORK, the derivation stops finding it. A ghost row
    // left ticked would tell the user their question is scoped to a Source
    // that no longer exists.
    await waitFor(() =>
      expect(result.current.selection.selected).toEqual([TAX_PICK]),
    );
  });

  it('raises the empty-scope flag when reconciliation empties the selection', async () => {
    let listCalls = 0;
    server.use(
      trpcMsw.chat.dataSources.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? [WORK_SOURCE] : [];
      }),
      trpcMsw.chat.dataSources.records.query(() => [
        receipt('m1', [WORK_PICK]),
      ]),
    );

    const { result } = renderSelection();
    await waitFor(() =>
      expect(result.current.selection.isEmptyScope).toBe(false),
    );

    await act(async () => {
      await result.current.queryClient.invalidateQueries();
    });

    // Losing the last selected Source silently means the next Turn retrieves
    // nothing, so the flag the composer's amber pip reads has to flip with it
    // — an empty scope the user did not choose is otherwise invisible.
    await waitFor(() =>
      expect(result.current.selection.isEmptyScope).toBe(true),
    );
    expect(result.current.selection.selected).toEqual([]);
    expect(result.current.selection.hasNoSources).toBe(true);
  });

  it('does not untick anything while the list is still in flight', async () => {
    server.use(
      trpcMsw.chat.dataSources.list.query(
        () =>
          new Promise<never>(() => {
            // never resolves — the owned list stays in flight
          }),
      ),
      trpcMsw.chat.dataSources.records.query(() => [
        receipt('m1', [WORK_PICK]),
      ]),
    );

    const { result } = renderSelection();

    // Intersecting against a list that has not arrived would untick everything
    // for the duration of the first fetch, which is indistinguishable from the
    // user having turned grounding off. The restored names come from the
    // record, so they render with no list at all.
    await waitFor(() =>
      expect(result.current.selection.selected).toEqual([WORK_PICK]),
    );
    expect(result.current.selection.isLoadingSources).toBe(true);
  });
});
