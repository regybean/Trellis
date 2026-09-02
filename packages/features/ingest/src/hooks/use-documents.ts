'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import { persistMeta } from '@acme/hooks';

import { useIngestQueryClient, useTRPC } from '../trpc/react';

/**
 * Data access for the Documents list: the indexed knowledge base and Document
 * deletion. Keeps `DocumentsList` UI-only (see CLAUDE.md — business logic in
 * hooks).
 */
export function useDocuments() {
  const trpc = useTRPC();
  const queryClient = useIngestQueryClient();

  // The Documents pane persists for offline read (ADR 0025) — it is the query
  // that buys the paint on a surface operators revisit constantly. Pinned to
  // ingest's own QueryClient (#82) so it runs on the persister-bearing client,
  // not a nested foreign one.
  const documentsQuery = useQuery(
    trpc.documents.list.queryOptions(undefined, { meta: persistMeta }),
    queryClient,
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
    deleteDocument: (filename: string) => deleteDocument.mutate({ filename }),
    isDeleting: deleteDocument.isPending,
  };
}
