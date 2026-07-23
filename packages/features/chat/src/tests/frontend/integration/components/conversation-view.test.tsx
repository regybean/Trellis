/**
 * ConversationView — navigation contract (ADR 0018, ticket #65).
 *
 * Renders the REAL <ConversationView> (sidebar + active Conversation) driving the
 * REAL useChat / useConversations hooks, network faked at the HTTP boundary via
 * trpcMsw. Asserts the deep-link URL the view projects onto the address bar via
 * the History API — the contract, not the internals.
 *
 * The URL must only carry the Conversation id once that Conversation is
 * resumable: a fresh chat stays on the bare route until the first Message is
 * sent; selecting an existing Conversation stamps its id immediately; a deep
 * link is already correct; "New chat" returns to bare. As in the ChatAssistant
 * test, the stream subscription can't be intercepted over httpLink, so send
 * tests use `onUnhandledRequest: 'bypass'` and assert the synchronous URL change
 * useChat.send drives before any network response.
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

import type { SelectConversationSummary } from '../../../../api/schemas/chat-schema';
import { ConversationView } from '../../../../components/conversation-view';
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
const OTHER_ID = '11111111-1111-4111-8111-111111111111';
const UUID_PATH = /^\/chat-assistant\/[0-9a-f-]{36}$/;

const conv = (sessionId: string, title: string): SelectConversationSummary => ({
  sessionId,
  title,
  updatedAt: new Date(),
  folderId: null,
});

// Base handlers so both hooks (useChat + useConversations) resolve for any id.
const baseHandlers = (conversations: SelectConversationSummary[] = []) => [
  trpcMsw.chat.get.query(() => []),
  trpcMsw.chat.inflightTurn.query(() => ({ turnId: null })),
  trpcMsw.chat.list.query(() => conversations),
  trpcMsw.chat.folders.list.query(() => []),
];

const setPath = (path: string) =>
  globalThis.history.replaceState(globalThis.history.state, '', path);

describe('ConversationView navigation', () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('keeps the URL bare on a new Conversation until the first send', async () => {
    setPath('/chat-assistant');
    server.use(...baseHandlers());

    renderWithProviders(<ConversationView />);
    await waitFor(() =>
      expect(screen.queryByTestId('message-skeleton')).toBeNull(),
    );

    expect(globalThis.location.pathname).toBe('/chat-assistant');
  });

  it('stamps /chat-assistant/{id} on the first send', async () => {
    setPath('/chat-assistant');
    server.use(...baseHandlers());
    const user = userEvent.setup();

    renderWithProviders(<ConversationView />);
    await waitFor(() =>
      expect(screen.queryByTestId('message-skeleton')).toBeNull(),
    );

    await user.type(screen.getByTestId('chat-input'), 'first message');
    await user.click(screen.getByTestId('chat-send-button'));

    await waitFor(() =>
      expect(globalThis.location.pathname).toMatch(UUID_PATH),
    );
  });

  it('leaves a deep link untouched on mount', async () => {
    setPath(`/chat-assistant/${SESSION_ID}`);
    server.use(...baseHandlers());

    renderWithProviders(<ConversationView initialSessionId={SESSION_ID} />);
    await waitFor(() =>
      expect(screen.queryByTestId('message-skeleton')).toBeNull(),
    );

    expect(globalThis.location.pathname).toBe(`/chat-assistant/${SESSION_ID}`);
  });

  it('stamps the id immediately when selecting an existing Conversation', async () => {
    setPath('/chat-assistant');
    server.use(...baseHandlers([conv(OTHER_ID, 'Previous chat')]));
    const user = userEvent.setup();

    renderWithProviders(<ConversationView />);
    await waitFor(() =>
      expect(
        screen.getByTestId(`conversation-${OTHER_ID}`),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByTestId(`conversation-${OTHER_ID}`));

    await waitFor(() =>
      expect(globalThis.location.pathname).toBe(`/chat-assistant/${OTHER_ID}`),
    );
  });

  it('returns the URL to bare when starting a new chat', async () => {
    setPath(`/chat-assistant/${SESSION_ID}`);
    server.use(...baseHandlers());
    const user = userEvent.setup();

    renderWithProviders(<ConversationView initialSessionId={SESSION_ID} />);
    await waitFor(() =>
      expect(screen.queryByTestId('message-skeleton')).toBeNull(),
    );

    await user.click(screen.getByTestId('new-conversation'));

    await waitFor(() =>
      expect(globalThis.location.pathname).toBe('/chat-assistant'),
    );
  });
});
