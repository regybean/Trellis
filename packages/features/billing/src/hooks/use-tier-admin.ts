'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useTRPC } from '../trpc/react';

export const TIERS = ['Basic', 'Standard', 'Pro'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Admin action to move a user between Tiers directly (localstripe dev only):
 * cancels any existing Subscription and, for a paid tier, creates one. Keeps
 * `TierManagement` UI-only.
 */
export function useTierAdmin(user: { id: string; email: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const setUserTier = useMutation(
    trpc.account.setUserTier.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(
          trpc.account.getUserSubscription.pathFilter(),
        );
        void queryClient.invalidateQueries(
          trpc.account.getUserRateLimitStatus.pathFilter(),
        );
        void queryClient.invalidateQueries(
          trpc.account.getCreditUsage.pathFilter(),
        );
      },
    }),
  );

  return {
    setTier: (tier: Tier, onDone: () => void) =>
      setUserTier.mutate(
        { userId: user.id, email: user.email, tier },
        { onSuccess: onDone },
      ),
    isPending: setUserTier.isPending,
    error: setUserTier.error,
    isSuccess: setUserTier.isSuccess,
  };
}
