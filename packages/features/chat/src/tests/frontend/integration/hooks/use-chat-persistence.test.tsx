/**
 * Offline read of Conversation History + Messages (#84, ADR 0025).
 *
 * The one new behaviour this ticket adds at the existing hook seam (ADR 0018):
 * a persisted query renders from IndexedDB on a cold `QueryClient` with the
 * network blocked. Each case primes the cache with the network available, then
 * mounts a fresh client whose only handler for the persisted query THROWS — so
 * a pass proves the data came from the persisted cache, not the wire. Asserts
 * hook state only; no mock call counts, no persister internals.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { createStore, keys } from 'idb-keyval';
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

const mustNotHit = (name: string) => () => {
  throw new Error(`${name} network hit — offline restore failed`);
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

    // Cold open, offline: chat.list would throw if reached, so a restored list
    // proves the read came from IndexedDB. Folders (not persisted) stay served.
    server.resetHandlers(
      trpcMsw.chat.list.query(mustNotHit('chat.list')),
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

    // Cold open, offline: chat.get would throw if reached; the restored Messages
    // prove the read came from IndexedDB. inflightTurn (not persisted) still
    // resolves so the mount probe is quiet and no stream opens.
    server.resetHandlers(
      trpcMsw.chat.get.query(mustNotHit('chat.get')),
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
