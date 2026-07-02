'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../trpc/react';

/**
 * Admin data access for a single user's rate limit (Credit balance): reads the
 * current status + Subscription, and exposes the three Redis-manipulating
 * actions (reset, max out, override expiry). Each action invalidates the
 * dependent queries on success and forwards an optional `onSuccess` so the
 * component can close its dialog. Keeps `RateLimitManagement` UI-only.
 */
export function useRateLimitAdmin(userId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries(
      trpc.account.getUserRateLimitStatus.pathFilter(),
    );
    void queryClient.invalidateQueries(trpc.account.getCreditUsage.pathFilter());
  };

  const rateLimitStatus = useQuery(
    trpc.account.getUserRateLimitStatus.queryOptions({ userId }),
  );

  const subscription = useQuery(
    trpc.account.getUserSubscription.queryOptions({ userId }),
  );

  const reset = useMutation(
    trpc.account.resetUserRateLimit.mutationOptions({ onSuccess: invalidate }),
  );

  const maxOut = useMutation(
    trpc.account.maxOutUserRateLimit.mutationOptions({ onSuccess: invalidate }),
  );

  const override = useMutation(
    trpc.account.overrideUserRateLimitExpiry.mutationOptions({
      onSuccess: invalidate,
    }),
  );

  return {
    rateLimitStatus,
    subscription,
    reset: {
      run: (onDone: () => void) =>
        reset.mutate({ userId }, { onSuccess: onDone }),
      isPending: reset.isPending,
      error: reset.error,
      isSuccess: reset.isSuccess,
    },
    maxOut: {
      run: (onDone: () => void) =>
        maxOut.mutate({ userId }, { onSuccess: onDone }),
      isPending: maxOut.isPending,
      error: maxOut.error,
      isSuccess: maxOut.isSuccess,
    },
    override: {
      run: (expiryTimestamp: number, onDone: () => void) =>
        override.mutate({ userId, expiryTimestamp }, { onSuccess: onDone }),
      isPending: override.isPending,
      error: override.error,
      isSuccess: override.isSuccess,
    },
  };
}
