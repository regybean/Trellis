/**
 * useRateLimitAdmin — integration/hooks (ADR 0018).
 *
 * The hook's contract: read a user's rate-limit status + Subscription, and
 * expose three Redis-manipulating actions (reset / maxOut / override) that each
 * run an `onDone` callback on success and flip their own isPending/isSuccess.
 * Drive the real hook through a real QueryClient with the network faked at the
 * HTTP boundary (MSW). Assert returned query data + action state + that onDone
 * fired — never spy on the mutations.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { TRPCError } from '@trpc/server';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useRateLimitAdmin } from '../../../../hooks/use-rate-limit-admin';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const USER_ID = 'user_target';
const resetAt = Math.floor(Date.now() / 1000) + 86_400;

const statusHandler = (remaining: number) =>
  trpcMsw.account.getUserRateLimitStatus.query(() => ({
    userId: USER_ID,
    tier: 'Standard',
    remaining,
    limit: 350,
    resetAt,
    keyExists: true,
  }));

const subscriptionHandler = () =>
  trpcMsw.account.getUserSubscription.query(() => ({
    userId: USER_ID,
    subscription: { status: 'none' as const },
  }));

const renderHookForUser = () =>
  renderHook(() => useRateLimitAdmin(USER_ID), { wrapper: Providers });

describe('useRateLimitAdmin', () => {
  it('reads rate-limit status and subscription for the user', async () => {
    server.use(statusHandler(200), subscriptionHandler());

    const { result } = renderHookForUser();

    await waitFor(() =>
      expect(result.current.rateLimitStatus.data?.remaining).toBe(200),
    );
    expect(result.current.subscription.data?.subscription.status).toBe('none');
  });

  it('runs onDone and flips isSuccess after a reset', async () => {
    server.use(
      statusHandler(200),
      subscriptionHandler(),
      trpcMsw.account.resetUserRateLimit.mutation(() => ({
        message: 'ok',
        userId: USER_ID,
        newCreditCount: 350,
        tier: 'Standard',
        resetAt,
      })),
    );

    const { result } = renderHookForUser();
    await waitFor(() =>
      expect(result.current.rateLimitStatus.isSuccess).toBe(true),
    );

    let done = false;
    act(() => result.current.reset.run(() => (done = true)));

    await waitFor(() => expect(result.current.reset.isSuccess).toBe(true));
    expect(done).toBe(true);
  });

  it('runs onDone after maxOut', async () => {
    server.use(
      statusHandler(200),
      subscriptionHandler(),
      trpcMsw.account.maxOutUserRateLimit.mutation(() => ({
        message: 'ok',
        userId: USER_ID,
        newCreditCount: 0,
        previousLimit: 350,
        tier: 'Standard',
        resetAt,
      })),
    );

    const { result } = renderHookForUser();
    await waitFor(() =>
      expect(result.current.subscription.isSuccess).toBe(true),
    );

    let done = false;
    act(() => result.current.maxOut.run(() => (done = true)));

    await waitFor(() => expect(result.current.maxOut.isSuccess).toBe(true));
    expect(done).toBe(true);
  });

  it('runs onDone with the given expiry after an override', async () => {
    const newExpiry = resetAt + 3600;
    server.use(
      statusHandler(200),
      subscriptionHandler(),
      trpcMsw.account.overrideUserRateLimitExpiry.mutation(() => ({
        message: 'ok',
        userId: USER_ID,
        newExpiryTimestamp: newExpiry,
        previousExpiryTimestamp: resetAt,
      })),
    );

    const { result } = renderHookForUser();
    await waitFor(() =>
      expect(result.current.subscription.isSuccess).toBe(true),
    );

    let done = false;
    act(() => result.current.override.run(newExpiry, () => (done = true)));

    await waitFor(() => expect(result.current.override.isSuccess).toBe(true));
    expect(done).toBe(true);
  });

  it('surfaces the error on the action (and does not run onDone) on failure', async () => {
    server.use(
      statusHandler(200),
      subscriptionHandler(),
      trpcMsw.account.resetUserRateLimit.mutation(() => {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'reset failed',
        });
      }),
    );

    const { result } = renderHookForUser();
    await waitFor(() =>
      expect(result.current.rateLimitStatus.isSuccess).toBe(true),
    );

    let done = false;
    act(() => result.current.reset.run(() => (done = true)));

    await waitFor(() => expect(result.current.reset.error).not.toBeNull());
    expect(result.current.reset.error?.message).toBe('reset failed');
    expect(done).toBe(false);
  });
});
