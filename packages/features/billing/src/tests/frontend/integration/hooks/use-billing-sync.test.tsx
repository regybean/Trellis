/**
 * useBillingSync — integration/hooks (ADR 0018).
 *
 * The hook's contract is a single cache-invalidation action: after Stripe syncs
 * a checkout server-side, `invalidateSubscription()` must invalidate the
 * Subscription + Credit-usage caches so a mounted consumer refetches. We drive
 * the real hook through a real QueryClient and observe the outcome — a live
 * query re-reads fresh data after invalidation — rather than spying on
 * invalidateQueries. Network faked at the HTTP boundary (MSW).
 */
import type { Mock } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { useAuth } from '@acme/auth';

import { useBillingSync } from '../../../../hooks/use-billing-sync';
import { useTRPC } from '../../../../trpc/react';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

beforeEach(() => {
  (useAuth as Mock).mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_1',
    sessionId: 'sess_1',
  });
});

describe('useBillingSync', () => {
  it('invalidateSubscription triggers a refetch that surfaces fresh data', async () => {
    let remaining = 100;
    server.use(
      trpcMsw.account.getCreditUsage.query(() => ({
        remaining,
        limit: 100,
        resetAt: Math.floor(Date.now() / 1000) + 86_400,
        usagePercentage: 0,
      })),
    );

    // A live consumer query plus the hook, sharing one QueryClient via Providers.
    const { result } = renderHook(
      () => {
        const trpc = useTRPC();
        const credit = useQuery(
          trpc.account.getCreditUsage.queryOptions(undefined, {
            enabled: true,
          }),
        );
        return { sync: useBillingSync(), credit };
      },
      { wrapper: Providers },
    );

    await waitFor(() =>
      expect(result.current.credit.data?.remaining).toBe(100),
    );

    // Server state moves on (Stripe synced); invalidation forces the refetch.
    remaining = 42;
    result.current.sync.invalidateSubscription();

    await waitFor(() => expect(result.current.credit.data?.remaining).toBe(42));
  });
});
