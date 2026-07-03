/**
 * useSubscriptionDetails — integration/hooks (ADR 0018).
 *
 * The hook is the frontend's contract: it reads the viewer's Subscription +
 * Credit usage, gated on Clerk being loaded + signed in. Drive the real hook
 * through a real QueryClient with the network faked at the HTTP boundary (MSW),
 * and assert the *returned state* — never mock trpc/react or spy on procedures.
 * @acme/auth is the one blessed framework external (already mocked in setup).
 */
import type { Mock } from 'vitest';
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

import { useSubscriptionDetails } from '../../../../hooks/use-subscription-details';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

const setAuth = (opts: { loaded?: boolean; signedIn?: boolean }) => {
  (useAuth as Mock).mockReturnValue({
    isLoaded: opts.loaded ?? true,
    isSignedIn: opts.signedIn ?? false,
    userId: opts.signedIn ? 'user_1' : null,
    sessionId: opts.signedIn ? 'sess_1' : null,
  });
};

const standardSub = () =>
  trpcMsw.account.getSubscriptionDetails.query(() => ({
    subscription: 'Standard' as const,
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 86_400,
    currentPeriodStart: Math.floor(Date.now() / 1000) - 86_400,
    cancelAtPeriodEnd: false,
    status: 'active' as const,
  }));

const creditUsage = () =>
  trpcMsw.account.getCreditUsage.query(() => ({
    remaining: 60,
    limit: 100,
    resetAt: Math.floor(Date.now() / 1000) + 86_400,
    usagePercentage: 40,
  }));

const renderUseSubscriptionDetails = () =>
  renderHook(() => useSubscriptionDetails(), { wrapper: Providers });

describe('useSubscriptionDetails', () => {
  beforeEach(() => setAuth({ signedIn: true }));

  it('exposes subscription + credit usage once both queries resolve', async () => {
    server.use(standardSub(), creditUsage());

    const { result } = renderUseSubscriptionDetails();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.subscriptionData?.subscription).toBe('Standard');
    expect(result.current.creditUsageData?.remaining).toBe(60);
    expect(result.current.creditUsageData?.usagePercentage).toBe(40);
  });

  it('stays loading with no data while signed out (queries disabled)', () => {
    setAuth({ signedIn: false });

    // No handlers registered: onUnhandledRequest:'error' would trip if the
    // disabled queries fired — proving the auth gate holds them.
    const { result } = renderUseSubscriptionDetails();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.subscriptionData).toBeUndefined();
    expect(result.current.creditUsageData).toBeUndefined();
  });

  it('stays loading with no data while auth is still loading', () => {
    setAuth({ loaded: false, signedIn: false });

    const { result } = renderUseSubscriptionDetails();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.subscriptionData).toBeUndefined();
  });
});
