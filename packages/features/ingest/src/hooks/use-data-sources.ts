'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import { useTRPC } from '../trpc/react';

/**
 * Data access for the caller's Data Sources: the list, and inline create.
 *
 * Deliberately NOT persisted to IndexedDB yet. `documents.list` is still the
 * only persisted ingest query, which is what its ADR says; opting this one in
 * is the documents-page rework's job, together with the in-place rewrite that
 * ADR needs.
 *
 * The id is minted here, client-side, so a rail row can appear optimistically
 * and still reconcile 1:1 with the server row. That is safe only because the
 * retrieval filter's first clause is `owner_id = <verified userId>`.
 */
export function useDataSources() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const dataSourcesQuery = useQuery(trpc.dataSources.list.queryOptions());

  const create = useMutation(
    trpc.dataSources.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.dataSources.list.pathFilter());
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return {
    dataSources: dataSourcesQuery.data ?? [],
    isLoading: dataSourcesQuery.isLoading,
    createDataSource: (name: string) =>
      create.mutateAsync({ id: crypto.randomUUID(), name }),
    isCreating: create.isPending,
  };
}
