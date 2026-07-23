/**
 * useFeedback — offline read (ADR 0025 / ADR 0018).
 *
 * The persister mechanism itself is verified once in `@acme/hooks`; here we
 * assert the *feature* wiring at the same seam the hook is already tested at
 * (the real hook + real QueryClient, network at the HTTP boundary via MSW):
 * once a Rating has been seen, it renders again on a fresh mount with the
 * network blocked. Asserts observable hook state — never mock call counts.
 */
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { createStore, keys } from 'idb-keyval';
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
const SCOPE = 'user-1';

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

// Persistence is opt-in per app via `scopeKey`; supplying one wires the
// `rq-feedback` persister into the feature's query client.
const scoped = ({ children }: { children: ReactNode }) => (
  <Providers scopeKey={SCOPE}>{children}</Providers>
);

describe('useFeedback offline read', () => {
  it('renders the persisted Rating on a fresh mount with the network blocked', async () => {
    // Phase 1: online. See a Rating, which the persister writes to `rq-feedback`.
    server.use(trpcMsw.feedback.forMessage.query(() => fakeRow('up')));

    const first = renderHook(() => useFeedback(messageId, threadId), {
      wrapper: scoped,
    });
    await waitFor(() => expect(first.result.current.rating).toBe('up'));

    // Wait for the async persist to flush to IndexedDB before tearing down.
    const store = createStore('rq-feedback', 'cache');
    await waitFor(async () => expect(await keys(store)).not.toHaveLength(0));
    first.unmount();

    // Phase 2: offline. No handlers registered → any request errors
    // (`onUnhandledRequest: 'error'`). A fresh query client shares the same
    // IndexedDB store + scope, so the Rating restores from cache with no fetch.
    server.resetHandlers();

    const second = renderHook(() => useFeedback(messageId, threadId), {
      wrapper: scoped,
    });
    await waitFor(() => expect(second.result.current.rating).toBe('up'));
  });
});
