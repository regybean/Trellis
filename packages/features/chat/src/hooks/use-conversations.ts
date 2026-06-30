'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useGenericErrorHandler } from '@acme/hooks';

import type { SelectConversationSummary } from '../api/schemas/chat-schema';
import type { SelectFolder } from '../api/schemas/folder-schema';
import { useTRPC } from '../trpc/react';

// Data access for the Conversation History sidebar. Components stay UI-focused
// and delegate here (see CLAUDE.md). All list-mutating actions are optimistic —
// cancel in-flight refetches, snapshot, patch the cache, roll back on error,
// then reconcile with the server on settle — so the UI feels instant while the
// server stays lazy (e.g. folder delete leaves dangling thread metadata).
export function useConversations() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const handleError = useGenericErrorHandler();

  const conversationsQuery = useQuery(trpc.chat.list.queryOptions());
  const foldersQuery = useQuery(trpc.chat.folders.list.queryOptions());

  const listKey = trpc.chat.list.queryKey();
  const foldersKey = trpc.chat.folders.list.queryKey();

  type Conversation = SelectConversationSummary;
  type Folder = SelectFolder;

  const setFolderMutation = useMutation(
    trpc.chat.setFolder.mutationOptions({
      onMutate: async ({ sessionId, folderId }) => {
        await queryClient.cancelQueries({ queryKey: listKey });
        const previous = queryClient.getQueryData<Conversation[]>(listKey);
        queryClient.setQueryData<Conversation[]>(listKey, (old) =>
          old?.map((c) => (c.sessionId === sessionId ? { ...c, folderId } : c)),
        );
        return { previous };
      },
      onError: (error, _vars, context) => {
        if (context?.previous)
          queryClient.setQueryData(listKey, context.previous);
        handleError(error);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }),
  );

  const deleteConversationMutation = useMutation(
    trpc.chat.delete.mutationOptions({
      onMutate: async ({ sessionId }) => {
        await queryClient.cancelQueries({ queryKey: listKey });
        const previous = queryClient.getQueryData<Conversation[]>(listKey);
        queryClient.setQueryData<Conversation[]>(listKey, (old) =>
          old?.filter((c) => c.sessionId !== sessionId),
        );
        return { previous };
      },
      onError: (error, _vars, context) => {
        if (context?.previous)
          queryClient.setQueryData(listKey, context.previous);
        handleError(error);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }),
  );

  const createFolderMutation = useMutation(
    trpc.chat.folders.create.mutationOptions({
      onError: handleError,
      onSettled: () => queryClient.invalidateQueries({ queryKey: foldersKey }),
    }),
  );

  const deleteFolderMutation = useMutation(
    trpc.chat.folders.delete.mutationOptions({
      // Optimistic: drop the Folder from the cache. Its Conversations keep a
      // dangling folderId in the list cache; the sidebar resolves folderId
      // against the (now shorter) folders list, so they fall back to their Date
      // Bucket immediately with no per-Conversation write — matching the lazy
      // server delete.
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey: foldersKey });
        const previous = queryClient.getQueryData<Folder[]>(foldersKey);
        queryClient.setQueryData<Folder[]>(foldersKey, (old) =>
          old?.filter((f) => f.id !== id),
        );
        return { previous };
      },
      onError: (error, _vars, context) => {
        if (context?.previous)
          queryClient.setQueryData(foldersKey, context.previous);
        handleError(error);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: foldersKey }),
    }),
  );

  return {
    conversations: conversationsQuery.data ?? [],
    folders: foldersQuery.data ?? [],
    isLoading: conversationsQuery.isLoading || foldersQuery.isLoading,
    setFolder: (sessionId: string, folderId: string | null) =>
      setFolderMutation.mutate({ sessionId, folderId }),
    deleteConversation: (sessionId: string) =>
      deleteConversationMutation.mutate({ sessionId }),
    createFolder: (name: string) => createFolderMutation.mutate({ name }),
    deleteFolder: (id: string) => deleteFolderMutation.mutate({ id }),
  };
}
