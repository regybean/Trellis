/**
 * useConversations — integration/hooks (ADR 0018).
 *
 * Drives the REAL useConversations hook through a real QueryClient with the
 * network faked at the HTTP boundary (MSW via trpcMsw). Asserts returned state
 * and cache transitions — optimistic updates visible immediately, rolling back
 * on error, reconciling on settle.
 *
 * No subscriptions: useConversations uses only queries and mutations, so MSW
 * can intercept all network calls and onUnhandledRequest:'error' is used
 * throughout.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SelectConversationSummary } from '../../../../api/schemas/chat-schema';
import type { SelectFolder } from '../../../../api/schemas/folder-schema';
import { useConversations } from '../../../../hooks/use-conversations';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ── Fixtures ─────────────────────────────────────────────────────────────
const conv = (sessionId: string, title: string): SelectConversationSummary => ({
  sessionId,
  title,
  updatedAt: new Date(),
  folderId: null,
});

const folder = (id: string, name: string): SelectFolder => ({
  id,
  name,
  userId: 'user_test',
  createdAt: new Date(),
});

const renderUseConversations = () =>
  renderHook(() => useConversations(), { wrapper: Providers });

// ── Reads ──────────────────────────────────────────────────────────────────
describe('useConversations – reads', () => {
  it('returns empty arrays before data loads', async () => {
    server.use(
      trpcMsw.chat.list.query(() => []),
      trpcMsw.chat.folders.list.query(() => []),
    );

    const { result } = renderUseConversations();

    // Before queries resolve, arrays default to [].
    expect(result.current.conversations).toEqual([]);
    expect(result.current.folders).toEqual([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('exposes loaded conversations and folders', async () => {
    const c1 = conv(crypto.randomUUID(), 'First chat');
    const f1 = folder(crypto.randomUUID(), 'My folder');
    server.use(
      trpcMsw.chat.list.query(() => [c1]),
      trpcMsw.chat.folders.list.query(() => [f1]),
    );

    const { result } = renderUseConversations();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversations).toContainEqual(
      expect.objectContaining({ title: 'First chat' }),
    );
    expect(result.current.folders).toContainEqual(
      expect.objectContaining({ name: 'My folder' }),
    );
  });
});

// ── deleteConversation ─────────────────────────────────────────────────────
describe('useConversations – deleteConversation', () => {
  it('removes conversation optimistically before server responds', async () => {
    const id = crypto.randomUUID();
    const c1 = conv(id, 'To delete');
    const c2 = conv(crypto.randomUUID(), 'Keeper');
    // Return only the keeper after the mutation settles (server reconciliation).
    let listCalls = 0;
    server.use(
      trpcMsw.chat.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? [c1, c2] : [c2];
      }),
      trpcMsw.chat.folders.list.query(() => []),
      trpcMsw.chat.delete.mutation(() => ({
        sessionId: id,
        userId: 'user_test',
        createdAt: new Date(),
      })),
    );

    const { result } = renderUseConversations();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conversations).toHaveLength(2);

    act(() => result.current.deleteConversation(id));

    // Optimistic update removes the row before the server responds.
    await waitFor(() =>
      expect(
        result.current.conversations.find((c) => c.sessionId === id),
      ).toBeUndefined(),
    );
  });

  it('rolls back when delete mutation errors', async () => {
    const id = crypto.randomUUID();
    const c1 = conv(id, 'Resilient');
    server.use(
      trpcMsw.chat.list.query(() => [c1]),
      trpcMsw.chat.folders.list.query(() => []),
      trpcMsw.chat.delete.mutation(() => {
        throw new Error('INTERNAL_SERVER_ERROR');
      }),
    );

    const { result } = renderUseConversations();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.deleteConversation(id));

    // After optimistic removal, the error triggers a rollback → row is restored.
    await waitFor(() =>
      expect(
        result.current.conversations.find((c) => c.sessionId === id),
      ).toBeDefined(),
    );
  });
});

// ── setFolder ──────────────────────────────────────────────────────────────
describe('useConversations – setFolder', () => {
  it('patches folderId in the cache optimistically', async () => {
    const sid = crypto.randomUUID();
    const fid = crypto.randomUUID();
    const c1 = conv(sid, 'Chat to move');
    // Second list call returns the updated row so the settled state matches.
    let listCalls = 0;
    server.use(
      trpcMsw.chat.list.query(() => {
        listCalls += 1;
        return listCalls === 1 ? [c1] : [{ ...c1, folderId: fid }];
      }),
      trpcMsw.chat.folders.list.query(() => []),
      trpcMsw.chat.setFolder.mutation(() => ({
        sessionId: sid,
        folderId: fid,
      })),
    );

    const { result } = renderUseConversations();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setFolder(sid, fid));

    // Optimistic: folderId is patched before the server responds.
    await waitFor(() => {
      const c = result.current.conversations.find((x) => x.sessionId === sid);
      expect(c?.folderId).toBe(fid);
    });
  });

  it('rolls back folderId when setFolder errors', async () => {
    const sid = crypto.randomUUID();
    const c1 = conv(sid, 'Chat');
    server.use(
      trpcMsw.chat.list.query(() => [c1]),
      trpcMsw.chat.folders.list.query(() => []),
      trpcMsw.chat.setFolder.mutation(() => {
        throw new Error('NOT_FOUND');
      }),
    );

    const { result } = renderUseConversations();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setFolder(sid, crypto.randomUUID()));

    // After rollback, the original folderId (null) is restored.
    await waitFor(() => {
      const c = result.current.conversations.find((x) => x.sessionId === sid);
      expect(c?.folderId).toBeNull();
    });
  });
});

// ── createFolder ───────────────────────────────────────────────────────────
describe('useConversations – createFolder', () => {
  it('appends folder optimistically before server responds', async () => {
    // Folder list starts empty; after mutation settles it returns the new row.
    let folderCalls = 0;
    const newFolderId = crypto.randomUUID();
    server.use(
      trpcMsw.chat.list.query(() => []),
      trpcMsw.chat.folders.list.query(() => {
        folderCalls += 1;
        return folderCalls === 1 ? [] : [folder(newFolderId, 'New folder')];
      }),
      trpcMsw.chat.folders.create.mutation(({ input }) =>
        folder(input.id, input.name),
      ),
    );

    const { result } = renderUseConversations();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.createFolder('New folder'));

    // Optimistic row appears immediately with userId='' (client-minted).
    await waitFor(() =>
      expect(
        result.current.folders.find((f) => f.name === 'New folder'),
      ).toBeDefined(),
    );
  });

  it('rolls back when createFolder errors', async () => {
    server.use(
      trpcMsw.chat.list.query(() => []),
      trpcMsw.chat.folders.list.query(() => []),
      trpcMsw.chat.folders.create.mutation(() => {
        throw new Error('INTERNAL_SERVER_ERROR');
      }),
    );

    const { result } = renderUseConversations();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.createFolder('Broken folder'));

    // Optimistic row appears then rolls back after error.
    await waitFor(() =>
      expect(
        result.current.folders.find((f) => f.name === 'Broken folder'),
      ).toBeUndefined(),
    );
  });
});

// ── deleteFolder ───────────────────────────────────────────────────────────
describe('useConversations – deleteFolder', () => {
  it('removes folder optimistically', async () => {
    const fid = crypto.randomUUID();
    const f1 = folder(fid, 'Doomed folder');
    // Second folders list call returns empty (server has deleted the folder).
    let folderCalls = 0;
    server.use(
      trpcMsw.chat.list.query(() => []),
      trpcMsw.chat.folders.list.query(() => {
        folderCalls += 1;
        return folderCalls === 1 ? [f1] : [];
      }),
      trpcMsw.chat.folders.delete.mutation(() => ({ id: fid })),
    );

    const { result } = renderUseConversations();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.folders).toHaveLength(1);

    act(() => result.current.deleteFolder(fid));

    // Optimistic: folder removed from cache immediately.
    await waitFor(() =>
      expect(result.current.folders.find((f) => f.id === fid)).toBeUndefined(),
    );
  });

  it('rolls back when deleteFolder errors', async () => {
    const fid = crypto.randomUUID();
    const f1 = folder(fid, 'Survivor');
    server.use(
      trpcMsw.chat.list.query(() => []),
      trpcMsw.chat.folders.list.query(() => [f1]),
      trpcMsw.chat.folders.delete.mutation(() => {
        throw new Error('INTERNAL_SERVER_ERROR');
      }),
    );

    const { result } = renderUseConversations();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.deleteFolder(fid));

    // After rollback, folder is restored.
    await waitFor(() =>
      expect(result.current.folders.find((f) => f.id === fid)).toBeDefined(),
    );
  });
});
