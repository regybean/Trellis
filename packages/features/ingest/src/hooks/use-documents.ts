'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import { usePersistedQueryOptions, useTRPC } from '../trpc/react';

/**
 * Data access for the Documents list: the caller's own Documents across every
 * Data Source they own (the `All documents` roll-up), and Document deletion.
 * Keeps `DocumentsList` UI-only (see CLAUDE.md — business logic in hooks).
 */
export function useDocuments() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const persisted = usePersistedQueryOptions();

  // The Documents pane persists for offline read — it is the query that buys
  // the paint on a surface operators revisit constantly.
  const documentsQuery = useQuery(
    trpc.documents.list.queryOptions({}, persisted),
  );

  const deleteDocument = useMutation(
    trpc.documents.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.documents.list.pathFilter());
        toast.success('Document deleted');
      },
      onError: () => toast.error('Failed to delete document'),
    }),
  );

  return {
    documents: documentsQuery.data ?? [],
    isLoading: documentsQuery.isLoading,
    // The Source is part of the argument because it is part of Document
    // identity: the same filename in two Sources is two Documents.
    deleteDocument: (dataSourceId: string, filename: string) =>
      deleteDocument.mutate({ dataSourceId, filename }),
    isDeleting: deleteDocument.isPending,
  };
}
