'use client';

import type { DataTag, QueryKey } from '@tanstack/react-query';
import type { TRPCClientErrorLike } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { useQueryClient } from '@tanstack/react-query';

import { useGenericErrorHandler } from './use-generic-error-handler';

/**
 * The cache protocol for one optimistic mutation, as a fragment to spread into
 * that mutation's options: cancel the queries in flight, snapshot what is
 * there, write the patch, roll the snapshot back and report the failure on
 * error, invalidate on settle. A caller supplies a query key and a patch and
 * states nothing else
 * ([ADR 0002](../docs/adr/0002-optimistic-mutation-protocol-as-a-fragment.md)).
 *
 * ```ts
 * useMutation(
 *   trpc.chat.delete.mutationOptions(
 *     useOptimisticMutationOptions(listKey, (conversations, { sessionId }) =>
 *       conversations?.filter((c) => c.sessionId !== sessionId),
 *     ),
 *   ),
 * );
 * ```
 *
 * **The order is the thing being shipped.** `cancelQueries` has to resolve
 * before the snapshot is read: a refetch already in flight will otherwise land
 * its body over the patch, or — worse — be captured as the value the rollback
 * restores, which is server state from before the mutation mixed with none of
 * the user's intent. Neither failure raises anything. Written out per call
 * site, correctness rests on each author remembering an ordering whose only
 * symptom is a list that occasionally reverts; written here, a call site cannot
 * express an order at all.
 *
 * **Invalidating on settle is what makes a client-minted id reconcile.** A
 * patch that appends a row the server also stores (a folder created with a
 * client-side uuid) leaves the cache holding the optimistic copy; the refetch
 * the invalidation triggers replaces the whole list with the server's, so the
 * row lands once, not twice. Because it runs on settle rather than on success,
 * the same refetch is also the backstop for a rollback that could not restore
 * an empty cache.
 *
 * The failure is reported through `useGenericErrorHandler`, so a rolled-back
 * list is never silent. That is deliberately not a caller's choice: every
 * rollback the user did not ask for needs saying out loud, and a mutation that
 * wants a bespoke message can add its own `onSuccess`/`onError` around the
 * spread.
 *
 * `taggedKey` must be a **tagged** key — `trpc.<path>.queryKey()`, or
 * TanStack's own `queryOptions({ ... }).queryKey`. The tag is what carries the
 * cached value's type, so `previous` and the patch's return are checked against
 * the real query without a generic argument or a cast at the call site.
 */
export function useOptimisticMutationOptions<TData, TVariables>(
  taggedKey: DataTag<QueryKey, TData, unknown>,
  patch: (
    previous: TData | undefined,
    variables: TVariables,
  ) => TData | undefined,
) {
  const queryClient = useQueryClient();
  const handleError = useGenericErrorHandler();

  // Read and written through the untagged key type. The tag's whole job is to
  // infer `TData` at the call site; passing it on would leave the inferred read
  // type deferred inside this generic and force a cast to get it back.
  const queryKey: QueryKey = taggedKey;

  return {
    onMutate: async (variables: TVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TData>(queryKey);
      queryClient.setQueryData<TData>(queryKey, (current) =>
        patch(current, variables),
      );
      return { previous };
    },
    onError: (
      error: TRPCClientErrorLike<AnyRouter>,
      _variables: TVariables,
      context: { previous: TData | undefined } | undefined,
    ) => {
      // `setQueryData` ignores `undefined`, so a mutation that failed before
      // `onMutate` ran — or one whose query held nothing to snapshot — leaves
      // the cache alone and waits for the settle invalidation.
      queryClient.setQueryData<TData>(queryKey, context?.previous);
      handleError(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  };
}
