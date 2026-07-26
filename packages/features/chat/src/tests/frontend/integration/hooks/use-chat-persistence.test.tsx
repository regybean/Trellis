/**
 * Offline read of Conversation History + Messages (#84, ADR 0025).
 *
 * The behaviour under test at the existing hook seam (ADR 0018): a persisted
 * query paints from IndexedDB on a cold `QueryClient`. Chat's client revalidates
 * on every mount (`refetchOnMount: 'always'`), so the guarantee is
 * stale-while-revalidate: the restored snapshot renders instantly AND a failed
 * background revalidation must never blank it. Each case primes the cache with
 * the network available, then mounts a fresh client whose only handler for the
 * persisted query THROWS (a stand-in for offline / an unreachable endpoint) — so
 * a pass proves the restored data survives even when the revalidation fetch
 * fails. Asserts hook state only; no mock call counts, no persister internals.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { createStore, keys } from 'idb-keyval';
import { delay } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SelectConversationSummary } from '../../../../api/schemas/chat-schema';
import type { SelectMessageSchema } from '../../../../api/schemas/message-schema';
import { useChat } from '../../../../hooks/use-chat';
import { useConversations } from '../../../../hooks/use-conversations';
import { ScopedProviders, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Chat's own IndexedDB store — `rq-chat`, keyed off its `keyPrefix`.
const chatStore = () => createStore('rq-chat', 'cache');
const persisted = async () => keys(chatStore());
const SCOPE = 'user-1';

// Stand-in for offline / an unreachable endpoint: the revalidation fetch that
// `refetchOnMount: 'always'` fires errors, and the restored cache must survive.
const offlineEndpoint = (name: string) => () => {
  throw new Error(`${name} unreachable — offline`);
};

describe('chat offline read — Conversation History (chat.list)', () => {
  it('restores the Conversation list from the persisted cache with no network', async () => {
    const c1: SelectConversationSummary = {
      sessionId: crypto.randomUUID(),
      title: 'Persisted chat',
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      folderId: null,
    };

    // Prime: network available, persister writes chat.list to IndexedDB.
    server.use(
      trpcMsw.chat.list.query(() => [c1]),
      trpcMsw.chat.folders.list.query(() => []),
    );
    const warm = renderHook(() => useConversations(), {
      wrapper: ScopedProviders(SCOPE),
    });
    await waitFor(() =>
      expect(warm.result.current.conversations).toHaveLength(1),
    );
    await waitFor(async () => expect(await persisted()).not.toHaveLength(0));
    warm.unmount();

    // Cold open, offline: the mount revalidation of chat.list errors, so a
    // restored list proves the persisted cache paints and survives the failed
    // refetch. Folders (not persisted) stay served.
    server.resetHandlers(
      trpcMsw.chat.list.query(offlineEndpoint('chat.list')),
      trpcMsw.chat.folders.list.query(() => []),
    );
    const cold = renderHook(() => useConversations(), {
      wrapper: ScopedProviders(SCOPE),
    });

    await waitFor(() =>
      expect(cold.result.current.conversations).toContainEqual(
        expect.objectContaining({ title: 'Persisted chat' }),
      ),
    );
  });
});

describe('chat offline read — history shows before Folders resolve', () => {
  it('renders the persisted Conversation list without waiting on chat.folders.list', async () => {
    const c1: SelectConversationSummary = {
      sessionId: crypto.randomUUID(),
      title: 'Persisted chat',
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      folderId: null,
    };

    // Prime: chat.list persists; folders served so the warm mount settles.
    server.use(
      trpcMsw.chat.list.query(() => [c1]),
      trpcMsw.chat.folders.list.query(() => []),
    );
    const warm = renderHook(() => useConversations(), {
      wrapper: ScopedProviders(SCOPE),
    });
    await waitFor(() =>
      expect(warm.result.current.conversations).toHaveLength(1),
    );
    await waitFor(async () => expect(await persisted()).not.toHaveLength(0));
    warm.unmount();

    // Cold open, slow network: chat.list restores from IndexedDB, but Folders
    // (never persisted) never resolves. The Conversation History must render
    // instantly from the restored list — not sit behind the Folders spinner.
    server.resetHandlers(
      trpcMsw.chat.list.query(offlineEndpoint('chat.list')),
      trpcMsw.chat.folders.list.query(async () => {
        await delay('infinite');
        return [];
      }),
    );
    const cold = renderHook(() => useConversations(), {
      wrapper: ScopedProviders(SCOPE),
    });

    await waitFor(() =>
      expect(cold.result.current.conversations).toContainEqual(
        expect.objectContaining({ title: 'Persisted chat' }),
      ),
    );
    // The sidebar gates its skeleton on this flag; it must be false so the
    // restored history is shown while Folders is still in flight.
    expect(cold.result.current.isLoading).toBe(false);
  });
});

describe('chat offline read — a Conversation’s Messages (chat.get)', () => {
  it('restores the Messages from the persisted cache with no network', async () => {
    const sessionId = crypto.randomUUID();
    const messages: SelectMessageSchema[] = [
      {
        id: crypto.randomUUID(),
        sessionId,
        role: 'user',
        text: 'what did we decide?',
        timestamp: new Date('2020-01-01T00:00:00.000Z'),
      },
      {
        id: crypto.randomUUID(),
        sessionId,
        role: 'assistant',
        text: 'we decided to persist the cache',
        timestamp: new Date('2020-01-01T00:00:01.000Z'),
      },
    ];

    // Prime: chat.get persists; inflightTurn is not persisted (benign null).
    server.use(
      trpcMsw.chat.get.query(() => messages),
      trpcMsw.chat.inflightTurn.query(() => ({ turnId: null })),
    );
    const warm = renderHook(() => useChat(sessionId), {
      wrapper: ScopedProviders(SCOPE),
    });
    await waitFor(() =>
      expect(
        warm.result.current.messages.some(
          (m) => m.text === 'we decided to persist the cache',
        ),
      ).toBe(true),
    );
    await waitFor(async () => expect(await persisted()).not.toHaveLength(0));
    warm.unmount();

    // Cold open, offline: the mount revalidation of chat.get errors; the
    // restored Messages must still render (a failed refetch never blanks the
    // cache). inflightTurn (not persisted) still resolves so the mount probe is
    // quiet and no stream opens.
    server.resetHandlers(
      trpcMsw.chat.get.query(offlineEndpoint('chat.get')),
      trpcMsw.chat.inflightTurn.query(() => ({ turnId: null })),
    );
    const cold = renderHook(() => useChat(sessionId), {
      wrapper: ScopedProviders(SCOPE),
    });

    await waitFor(() =>
      expect(
        cold.result.current.messages.some(
          (m) => m.text === 'we decided to persist the cache',
        ),
      ).toBe(true),
    );
  });
});
