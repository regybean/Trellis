import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { useTRPC } from '@acme/billing';

/**
 * App-owned replacement for the Next-coupled `StripeSuccessRedirect`
 * (`useRouter` from `next/navigation`). Reuses the billing `useTRPC` to
 * invalidate the credit/subscription queries, then navigates home via the
 * TanStack router. The timed side effect is the rare legitimate `useEffect`.
 */
export function StripeSuccessRedirect() {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries(
        trpc.account.getCreditUsage.pathFilter(),
      );
      void queryClient.invalidateQueries(
        trpc.account.getSubscriptionDetails.pathFilter(),
      );
      setTimeout(() => void navigate({ to: '/' }), 1000);
    }, 2000);

    return () => clearTimeout(timer);
  }, [navigate, queryClient, trpc]);

  return null;
}
