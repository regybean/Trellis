/**
 * useTierAdmin — integration/hooks (ADR 0018).
 *
 * The hook's contract: `setTier(tier, onDone)` fires the admin setUserTier
 * mutation, runs `onDone` on success, and exposes isPending/isSuccess/error.
 * On success it also invalidates the user-subscription / rate-limit / credit
 * caches. Drive the real hook through a real QueryClient with the network faked
 * at the HTTP boundary (MSW). Assert returned state + that onDone fired — never
 * spy on the mutation.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { TRPCError } from '@trpc/server';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useTierAdmin } from '../../../../hooks/use-tier-admin';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const USER = { id: 'user_target', email: 'target@test.dev' };

const renderTierAdmin = () =>
  renderHook(() => useTierAdmin(USER), { wrapper: Providers });

describe('useTierAdmin', () => {
  it('runs onDone and flips isSuccess after setting a tier', async () => {
    server.use(
      trpcMsw.account.setUserTier.mutation(() => ({
        message: 'ok',
        userId: USER.id,
        tier: 'Pro',
        status: 'active',
      })),
    );

    const { result } = renderTierAdmin();
    expect(result.current.isSuccess).toBe(false);

    let done = false;
    act(() => result.current.setTier('Pro', () => (done = true)));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(done).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('reports isPending while the mutation is in flight', async () => {
    server.use(
      trpcMsw.account.setUserTier.mutation(
        () =>
          new Promise<never>(() => {
            /* never resolves */
          }),
      ),
    );

    const { result } = renderTierAdmin();

    act(() =>
      result.current.setTier('Standard', () => {
        /* no-op */
      }),
    );

    await waitFor(() => expect(result.current.isPending).toBe(true));
  });

  it('surfaces the error and does not run onDone on failure', async () => {
    server.use(
      trpcMsw.account.setUserTier.mutation(() => {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'tier change failed',
        });
      }),
    );

    const { result } = renderTierAdmin();

    let done = false;
    act(() => result.current.setTier('Pro', () => (done = true)));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('tier change failed');
    expect(done).toBe(false);
  });
});
