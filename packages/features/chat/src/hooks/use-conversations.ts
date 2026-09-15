'use client';

import { useMutation, useQuery } from '@tanstack/react-query';

import { useOptimisticMutationOptions } from '@acme/hooks';

import type { SelectFolder } from '../api/schemas/folder-schema';
import { usePersistedQueryOptions, useTRPC } from '../trpc/react';

// Data access for the Conversation History sidebar. Components stay UI-focused
// and delegate here (see CLAUDE.md). All list-mutating actions are optimistic —
// the cache protocol (cancel, snapshot, patch, roll back, invalidate) is
// `useOptimisticMutationOptions`; each mutation below states only its patch, so
// the UI feels instant while the server stays lazy (e.g. folder delete leaves
// dangling thread metadata).
export function useConversations() {
  const trpc = useTRPC();
  const persisted = usePersistedQueryOptions();

  // Conversation History persists for offline read; Folders do not (a dangling
  // folderId simply falls back to its Date Bucket), which is why only the first
  // spreads `persisted`.
  const conversationsQuery = useQuery(
    trpc.chat.list.queryOptions(undefined, persisted),
  );
  const foldersQuery = useQuery(trpc.chat.folders.list.queryOptions());

  const listKey = trpc.chat.list.queryKey();
  const foldersKey = trpc.chat.folders.list.queryKey();

  const setFolderMutation = useMutation(
    trpc.chat.setFolder.mutationOptions(
      useOptimisticMutationOptions(
        listKey,
        (conversations, { sessionId, folderId }) =>
          conversations?.map((c) =>
            c.sessionId === sessionId ? { ...c, folderId } : c,
          ),
      ),
    ),
  );

  const deleteConversationMutation = useMutation(
    trpc.chat.delete.mutationOptions(
      useOptimisticMutationOptions(listKey, (conversations, { sessionId }) =>
        conversations?.filter((c) => c.sessionId !== sessionId),
      ),
    ),
  );

  const createFolderMutation = useMutation(
    trpc.chat.folders.create.mutationOptions(
      // Append the Folder with its client-minted id, so it appears in the
      // sidebar without waiting for the round-trip. The server inserts that
      // same id, so the row reconciles 1:1 when the invalidation lands.
      // Appending matches the server's `createdAt ASC` ordering.
      useOptimisticMutationOptions(foldersKey, (folders, { id, name }) => {
        const optimistic: SelectFolder = {
          id,
          name,
          userId: '',
          createdAt: new Date(),
        };
        return [...(folders ?? []), optimistic];
      }),
    ),
  );

  const deleteFolderMutation = useMutation(
    trpc.chat.folders.delete.mutationOptions(
      // Drop the Folder from the cache. Its Conversations keep a dangling
      // folderId in the list cache; the sidebar resolves folderId against the
      // (now shorter) folders list, so they fall back to their Date Bucket
      // immediately with no per-Conversation write — matching the lazy server
      // delete.
      useOptimisticMutationOptions(foldersKey, (folders, { id }) =>
        folders?.filter((f) => f.id !== id),
      ),
    ),
  );

  return {
    conversations: conversationsQuery.data ?? [],
    folders: foldersQuery.data ?? [],
    // Gate the sidebar skeleton on the *persisted* history query only. Folders
    // are not persisted, so `||`-ing them in would keep the whole sidebar
    // skeletoned until the network responds — defeating the instant offline
    // restore of the Conversation History. A Conversation whose folder hasn't
    // loaded yet simply falls back to its Date Bucket until it does.
    isLoading: conversationsQuery.isLoading,
    setFolder: (sessionId: string, folderId: string | null) =>
      setFolderMutation.mutate({ sessionId, folderId }),
    deleteConversation: (sessionId: string) =>
      deleteConversationMutation.mutate({ sessionId }),
    createFolder: (name: string) =>
      createFolderMutation.mutate({ id: crypto.randomUUID(), name }),
    deleteFolder: (id: string) => deleteFolderMutation.mutate({ id }),
  };
}
