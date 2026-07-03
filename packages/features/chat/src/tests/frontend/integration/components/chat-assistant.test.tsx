/**
 * ChatAssistant — integration/components (ADR 0018).
 *
 * Renders the REAL <ChatAssistant> driving the REAL useChat hook. Network faked
 * at the HTTP boundary via `trpcMsw` (msw-trpc). No vi.mock of the hook or
 * the tRPC client — those are the contracts we exercise.
 *
 * Subscription (streaming) note:
 *   In test mode `trpc/react.tsx` uses a plain `httpLink` for ALL calls,
 *   including subscriptions. tRPC subscriptions over httpLink are not proper SSE
 *   — they resolve as a regular HTTP round-trip. MSW cannot intercept
 *   tRPC subscriptions via httpLink reliably, so we rely on the synchronous
 *   optimistic state that `useChat.send` writes BEFORE the subscription
 *   resolves: user text and an assistant loading placeholder are appended to
 *   `localMessages` immediately on send. We assert that observable DOM change.
 *   `onUnhandledRequest: 'bypass'` is used for send tests so any stray
 *   subscription request doesn't throw — we never assert on its outcome.
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

import { MAX_MESSAGE_LENGTH } from '../../../../api/schemas/chat-schema';
import { ChatAssistant } from '../../../../components/chat-assistant';
import { renderWithProviders, trpcMsw } from '../../setup';

// scrollIntoView / scrollTo are not implemented in jsdom.
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  writable: true,
});
Object.defineProperty(globalThis, 'scrollTo', {
  value: vi.fn(),
  writable: true,
});

const SESSION_ID = '00000000-0000-4000-8000-000000000000';

// Re-used greeting for a new/empty session (chat.get returns [] → useChat
// shows the `initial` greeting passed by <ChatAssistant>).
const GREETING =
  'I am an AI assistant ready to answer questions about your documents. How may I help you today?';

describe('ChatAssistant', () => {
  // ── Render + greeting ──────────────────────────────────────────────────
  describe('rendering', () => {
    const server = setupServer();
    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    it('shows the greeting, input, and send button for a new session', async () => {
      // New session: chat.get returns [] → useChat shows the initial greeting.
      server.use(trpcMsw.chat.get.query(() => []));

      renderWithProviders(<ChatAssistant sessionId={SESSION_ID} />);

      // Input and button render synchronously.
      expect(screen.getByTestId('chat-input')).toBeInTheDocument();
      expect(screen.getByTestId('chat-send-button')).toBeInTheDocument();

      // Greeting renders once the history query settles.
      await waitFor(() =>
        expect(screen.getByText(GREETING)).toBeInTheDocument(),
      );
    });
  });

  // ── Optimistic send ────────────────────────────────────────────────────
  // These tests assert the synchronous optimistic state written by useChat.send
  // before any network response arrives. `onUnhandledRequest: 'bypass'` lets
  // the subscription request through without error (we don't assert on it).
  describe('optimistic send', () => {
    const server = setupServer();
    beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    it('appends user message to DOM after clicking send', async () => {
      server.use(trpcMsw.chat.get.query(() => []));
      const user = userEvent.setup();

      renderWithProviders(<ChatAssistant sessionId={SESSION_ID} />);
      await waitFor(() =>
        expect(screen.getByText(GREETING)).toBeInTheDocument(),
      );

      const input = screen.getByTestId('chat-input');
      const sendButton = screen.getByTestId('chat-send-button');

      const msg = 'Hello from integration test';
      await user.type(input, msg);
      await user.click(sendButton);

      // useChat.send synchronously appends the user message to localMessages
      // before the subscription fires — assert the DOM reflects it.
      await waitFor(() => expect(screen.getByText(msg)).toBeInTheDocument());
    });

    it('appends user message after pressing Enter', async () => {
      server.use(trpcMsw.chat.get.query(() => []));
      const user = userEvent.setup();

      renderWithProviders(<ChatAssistant sessionId={SESSION_ID} />);
      await waitFor(() =>
        expect(screen.getByText(GREETING)).toBeInTheDocument(),
      );

      const input = screen.getByTestId('chat-input');
      const msg = 'Enter key test message';
      await user.type(input, msg);
      await user.type(input, '{Enter}');

      await waitFor(() => expect(screen.getByText(msg)).toBeInTheDocument());
    });
  });

  // ── Pure-client error path (no network) ───────────────────────────────
  // A message longer than MAX_MESSAGE_LENGTH makes send() write an error
  // assistant message to localMessages without touching the network. No handlers
  // needed — onUnhandledRequest:'error' verifies no request leaks.
  describe('message too long', () => {
    const server = setupServer();
    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    it('shows an error message when input exceeds MAX_MESSAGE_LENGTH', async () => {
      server.use(trpcMsw.chat.get.query(() => []));
      const user = userEvent.setup();

      renderWithProviders(<ChatAssistant sessionId={SESSION_ID} />);
      await waitFor(() =>
        expect(screen.getByText(GREETING)).toBeInTheDocument(),
      );

      const input = screen.getByTestId('chat-input');
      const sendButton = screen.getByTestId('chat-send-button');

      // One character over the limit — useChat.send short-circuits without
      // setting queryInput (no subscription fires). Use paste (not type) to
      // avoid keystroke-by-keystroke slowness for a 10001-char string.
      const longMessage = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
      await user.click(input);
      await user.paste(longMessage);
      await user.click(sendButton);

      await waitFor(() =>
        expect(
          screen.getByText(
            `Message is too long (${longMessage.length} characters). Please keep messages under ${MAX_MESSAGE_LENGTH} characters.`,
          ),
        ).toBeInTheDocument(),
      );
    });
  });
});
