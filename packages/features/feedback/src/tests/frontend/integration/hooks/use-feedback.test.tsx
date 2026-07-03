/**
 * useFeedback — integration/hooks (ADR 0018).
 *
 * The hook is the frontend's contract (logic lives in `src/hooks/` per the slice
 * contract). This is the reference hook test: drive the real hook through a real
 * QueryClient with the network faked at the HTTP boundary (MSW via `trpcMsw`),
 * then assert the *returned state* — `rating` transitions after a mutation's
 * `onSettled` invalidation refetches. No mock-call assertions; the contract is
 * the observable state, not which procedure fired.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useFeedback } from '../../../../hooks/use-feedback';
import { Providers, trpcMsw } from '../../setup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const messageId = crypto.randomUUID();
const threadId = crypto.randomUUID();

const fakeRow = (rating: 'up' | 'down') => ({
  id: crypto.randomUUID(),
  messageId,
  threadId,
  userId: 'user_test',
  rating,
  comment: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const renderUseFeedback = () =>
  renderHook(() => useFeedback(messageId, threadId), { wrapper: Providers });

describe('useFeedback', () => {
  it('reads no rating when the message has no feedback', async () => {
    server.use(trpcMsw.feedback.forMessage.query(() => null));

    const { result } = renderUseFeedback();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rating).toBeNull();
  });

  it('reflects a rating after submit settles and the query refetches', async () => {
    let calls = 0;
    server.use(
      trpcMsw.feedback.forMessage.query(() => {
        calls += 1;
        return calls === 1 ? null : fakeRow('up');
      }),
      trpcMsw.feedback.submit.mutation(() => fakeRow('up')),
    );

    const { result } = renderUseFeedback();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.rate('up'));

    await waitFor(() => expect(result.current.rating).toBe('up'));
  });

  it('clears the rating when the active value is chosen again (toggle off)', async () => {
    let calls = 0;
    server.use(
      trpcMsw.feedback.forMessage.query(() => {
        calls += 1;
        return calls === 1 ? fakeRow('up') : null;
      }),
      trpcMsw.feedback.remove.mutation(() => ({ messageId })),
    );

    const { result } = renderUseFeedback();
    await waitFor(() => expect(result.current.rating).toBe('up'));

    act(() => result.current.rate('up'));

    await waitFor(() => expect(result.current.rating).toBeNull());
  });
});
