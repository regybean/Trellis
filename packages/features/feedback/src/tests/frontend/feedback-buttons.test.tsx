/**
 * FeedbackButtons component tests.
 *
 * - `renderWithProviders` wraps the component in the tRPC + React Query providers.
 * - `trpcMsw` (msw-trpc) provides type-safe mocks for this feature's procedures.
 * - A real MSW `setupServer` intercepts the HTTP calls the tRPC client makes.
 *
 * No database or network is touched — only the tRPC HTTP layer is mocked.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import '@testing-library/jest-dom';

import { FeedbackButtons } from '../../components/feedback-buttons';
import { renderWithProviders, trpcMsw } from './setup';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
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

describe('FeedbackButtons', () => {
  it('renders both controls unpressed when there is no feedback', async () => {
    server.use(trpcMsw.feedback.forMessage.query(() => null));

    renderWithProviders(
      <FeedbackButtons messageId={messageId} threadId={threadId} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('feedback-up')).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
    expect(screen.getByTestId('feedback-down')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('submits a rating and reflects it after the list refetches', async () => {
    let forMessageCalls = 0;
    server.use(
      trpcMsw.feedback.forMessage.query(() => {
        forMessageCalls += 1;
        return forMessageCalls === 1 ? null : fakeRow('up');
      }),
      trpcMsw.feedback.submit.mutation(() => fakeRow('up')),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackButtons messageId={messageId} threadId={threadId} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('feedback-up')).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );

    await user.click(screen.getByTestId('feedback-up'));

    await waitFor(() =>
      expect(screen.getByTestId('feedback-up')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('clears the active rating when clicked again (toggle off)', async () => {
    let forMessageCalls = 0;
    let removeCalled = false;
    server.use(
      trpcMsw.feedback.forMessage.query(() => {
        forMessageCalls += 1;
        return forMessageCalls === 1 ? fakeRow('up') : null;
      }),
      trpcMsw.feedback.remove.mutation(() => {
        removeCalled = true;
        return { messageId };
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <FeedbackButtons messageId={messageId} threadId={threadId} />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('feedback-up')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );

    await user.click(screen.getByTestId('feedback-up'));

    await waitFor(() => expect(removeCalled).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('feedback-up')).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
  });
});
