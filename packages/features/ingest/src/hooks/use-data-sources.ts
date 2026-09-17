'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import { usePersistedQueryOptions, useTRPC } from '../trpc/react';

/**
 * Data access for the documents page's rail: the caller's Data Sources, the
 * advisory quota caps, inline create and delete.
 *
 * `dataSources.list` opts into the per-query IndexedDB persister alongside
 * `documents.list`. It is small, it changes rarely, and the rail is the frame
 * the whole page hangs off — restoring it is what keeps a cold open from
 * painting an empty rail beside a populated detail pane. Safe because the rail
 * is a management surface only: no privacy decision reads a name from here (the
 * chat-side tooltip and "Sources included" read the per-Message record), so a
 * ghost row in a stale rail is cosmetic.
 *
 * `dataSources.limits` is deliberately NOT persisted. It is two integers behind
 * one round trip, and persisting it would put a retunable cap on disk for a day
 * for no paint worth having.
 *
 * The create id is minted here, client-side, so a rail row can appear
 * optimistically and still reconcile 1:1 with the server row. That is safe only
 * because the retrieval filter's first clause is `owner_id = <verified
 * userId>`.
 */
export function useDataSources() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const persisted = usePersistedQueryOptions();

  const dataSourcesQuery = useQuery(
    trpc.dataSources.list.queryOptions(undefined, persisted),
  );

  const limitsQuery = useQuery(trpc.dataSources.limits.queryOptions());

  const create = useMutation(
    trpc.dataSources.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.dataSources.list.pathFilter());
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  // Deleting a Source takes its Documents with it, so the documents list is
  // invalidated too — otherwise the rail loses the row while the roll-up pane
  // keeps rendering its files.
  const remove = useMutation(
    trpc.dataSources.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.dataSources.list.pathFilter());
        void queryClient.invalidateQueries(trpc.documents.list.pathFilter());
        toast.success('Data source deleted');
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return {
    dataSources: dataSourcesQuery.data ?? [],
    isLoading: dataSourcesQuery.isLoading,
    // Undefined while the caps are in flight, which is what lets every caller
    // omit an advisory hint rather than render a wrong one.
    maxDataSourcesPerUser: limitsQuery.data?.maxDataSourcesPerUser,
    maxDocumentsPerDataSource: limitsQuery.data?.maxDocumentsPerDataSource,
    createDataSource: (name: string) =>
      create.mutateAsync({ id: crypto.randomUUID(), name }),
    isCreating: create.isPending,
    deleteDataSource: (id: string) => remove.mutate({ id }),
    isDeleting: remove.isPending,
  };
}
