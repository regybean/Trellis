/**
 * useChat — integration/hooks (ADR 0018).
 *
 * Drives the REAL useChat hook through a real QueryClient with the network
 * faked at the HTTP boundary (MSW via trpcMsw). Asserts returned state.
 *
 * SUBSCRIPTION CONSTRAINT (ADR 0018): MSW cannot drive a tRPC SSE subscription
 * in jsdom — an enabled reader only ever transitions `connecting → error`, never
 * delivering `onData` deltas/terminals or a clean `idle` close. So the split is:
 *   - The control-plane MUTATIONS (`chat.send` / `chat.stop` / `chat.reconcileTurn`)
 *     ARE MSW-interceptable, so their contract is asserted here.
 *   - Streaming OUTCOMES (token append, `done`/`cancelled`/`error` terminals)
 *     cannot be asserted and live in chat-assistant.test.tsx as documented notes.
 * The orphan path is the one seam that bridges both: the jsdom subscription's
 * natural unrecoverable `error` closes the reader with no terminal, which the
 * hook treats as an orphan — so `chat.reconcileTurn` + its refund toast DO run
 * and are asserted here through the real `<ToastContainer />`.
 * Paths that open the reader use `onUnhandledRequest: 'bypass'` so the SSE
 * request itself does not fail the strict MSW server.
 */
import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SelectConversationSummary } from '../../../../api/schemas/chat-schema';
import type {
  Message,
  SelectMessageSchema,
} from '../../../../api/schemas/message-schema';
import { MAX_MESSAGE_LENGTH } from '../../../../api/schemas/chat-schema';
import { useChat } from '../../../../hooks/use-chat';
import { useTRPC } from '../../../../trpc/react';
import { Providers, trpcMsw } from '../../setup';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const TURN_ID = '00000000-0000-4000-8000-0000000000a1';

const greeting: Message[] = [
  { role: 'assistant', text: 'Hello! How can I help?' },
];

const historyMsg = (text: string): SelectMessageSchema => ({
  id: crypto.randomUUID(),
  sessionId: SESSION_ID,
  role: 'user',
  text,
  timestamp: new Date(),
});

const renderUseChat = (initial = greeting, sessionId = SESSION_ID) =>
  renderHook(() => useChat(initial, sessionId), { wrapper: Providers });

// ── Group 1: loading / history path ───────────────────────────────────────
// All tests here need only chat.get — MSW is strict so unhandled requests fail.
describe('useChat – history loading', () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('shows greeting when chat.get returns empty (new session)', async () => {
    server.use(trpcMsw.chat.get.query(() => []));

    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));
    expect(result.current.messages).toEqual(greeting);
  });

  it('shows persisted history when chat.get returns messages', async () => {
    const msg = historyMsg('Prior user message');
    server.use(trpcMsw.chat.get.query(() => [msg]));

    const { result } = renderUseChat();

    await waitFor(() =>
      expect(result.current.messages).toContainEqual(
        expect.objectContaining({ text: 'Prior user message' }),
      ),
    );
    expect(result.current.isHistoryLoading).toBe(false);
  });

  it('falls back to greeting when chat.get errors', async () => {
    server.use(
      trpcMsw.chat.get.query(() => {
        throw new Error('NOT_FOUND');
      }),
    );

    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));
    expect(result.current.messages).toEqual(greeting);
  });

  it('isHistoryLoading is false after query settles', async () => {
    server.use(trpcMsw.chat.get.query(() => []));

    const { result } = renderUseChat();

    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));
  });
});

// ── Group 2: optimistic send (pure-client state, bypass subscription) ─────
// send() writes synchronous optimistic state before the subscription fires.
// `onUnhandledRequest: 'bypass'` silences the EventSource-not-a-constructor
// error that comes from the subscription attempting to open in jsdom.
describe('useChat – optimistic send', () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('appends user message and loading assistant placeholder synchronously', async () => {
    server.use(trpcMsw.chat.get.query(() => []));

    const { result } = renderUseChat();
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));

    act(() => result.current.send('Hello'));

    const msgs = result.current.messages;
    expect(
      msgs.find((m) => m.role === 'user' && m.text === 'Hello'),
    ).toBeDefined();
    expect(msgs.find((m) => m.role === 'assistant' && m.loading)).toBeDefined();
  });

  it('seeds localMessages from history on first send', async () => {
    const prior = historyMsg('Old message');
    server.use(trpcMsw.chat.get.query(() => [prior]));

    const { result } = renderUseChat();
    await waitFor(() =>
      expect(result.current.messages).toContainEqual(
        expect.objectContaining({ text: 'Old message' }),
      ),
    );

    act(() => result.current.send('New message'));

    const msgs = result.current.messages;
    expect(msgs[0]).toEqual(expect.objectContaining({ text: 'Old message' }));
    expect(msgs.find((m) => m.text === 'New message')).toBeDefined();
  });

  it('ignores second send while subscription is connecting', async () => {
    server.use(trpcMsw.chat.get.query(() => []));

    const { result } = renderUseChat();
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));

    act(() => result.current.send('First'));
    const countAfterFirst = result.current.messages.length;

    // Second send while isLoading (subscription.status === 'connecting') → no-op.
    act(() => result.current.send('Second'));
    expect(result.current.messages.length).toBe(countAfterFirst);
  });
});

// ── Group 3: pure-client validation (no network needed) ───────────────────
// Message-too-long path never sets queryInput so no subscription fires.
// Strict onUnhandledRequest ensures no stray request leaks.
describe('useChat – message length validation', () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('shows error message when text exceeds MAX_MESSAGE_LENGTH', async () => {
    server.use(trpcMsw.chat.get.query(() => []));

    const { result } = renderUseChat();
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));

    const longText = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    act(() => result.current.send(longText));

    const msgs = result.current.messages;
    const errorMsg = msgs.find((m) => m.error && m.role === 'assistant');
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.text).toContain(`${longText.length} characters`);
  });

  it('still shows the user message alongside the error', async () => {
    server.use(trpcMsw.chat.get.query(() => []));

    const { result } = renderUseChat();
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));

    const longText = 'x'.repeat(MAX_MESSAGE_LENGTH + 1);
    act(() => result.current.send(longText));

    const msgs = result.current.messages;
    expect(
      msgs.find((m) => m.role === 'user' && m.text === longText),
    ).toBeDefined();
  });

  it('does not set isLoading for a too-long message', async () => {
    server.use(trpcMsw.chat.get.query(() => []));

    const { result } = renderUseChat();
    await waitFor(() => expect(result.current.isHistoryLoading).toBe(false));

    act(() => result.current.send('b'.repeat(MAX_MESSAGE_LENGTH + 1)));

    // No subscription started, so isLoading must remain false.
    expect(result.current.isLoading).toBe(false);
  });
});

// ── Group 4: durable-stream control plane (send / stop / reconcile) ────────
// The T4 mutations are MSW-interceptable, so their contract is asserted through
// the real hook. The reader is opened as a side effect; `bypass` lets its SSE
// request through without failing the server.
const sendAccepted = () =>
  trpcMsw.chat.send.mutation(() => ({
    status: 'accepted' as const,
    turnId: TURN_ID,
  }));
const sendAlreadyInflight = () =>
  trpcMsw.chat.send.mutation(() => ({ status: 'alreadyInflight' as const }));

// Render useChat alongside the tRPC list query key + QueryClient so the
// optimistic sidebar cache can be inspected without a network round-trip.
const renderChat = () =>
  renderHook(
    () => {
      const trpc = useTRPC();
      const queryClient = useQueryClient();
      const chat = useChat(greeting, SESSION_ID);
      return { chat, listKey: trpc.chat.list.queryKey(), queryClient };
    },
    { wrapper: Providers },
  );

describe('useChat – control plane', () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('marks a Turn in-flight and prepends a "New chat" on accepted', async () => {
    server.use(
      trpcMsw.chat.get.query(() => []),
      sendAccepted(),
      // The jsdom reader closes with an error → the owned Turn reconciles; hand
      // it a clean response so the post-assertion settle stays quiet.
      trpcMsw.chat.reconcileTurn.mutation(() => ({ refunded: true })),
    );

    const { result } = renderChat();
    await waitFor(() =>
      expect(result.current.chat.isHistoryLoading).toBe(false),
    );

    act(() => result.current.chat.send('Hello'));

    // The send-gate closes immediately (mutation pending → reader open) so the
    // user cannot fire a duplicate Turn; the input stays editable regardless.
    expect(result.current.chat.isSending).toBe(true);

    // Optimistic Conversation prepended to the sidebar cache titled "New chat".
    const list = result.current.queryClient.getQueryData<
      SelectConversationSummary[]
    >(result.current.listKey);
    expect(list?.[0]).toEqual(
      expect.objectContaining({ sessionId: SESSION_ID, title: 'New chat' }),
    );
  });

  it('attaches without re-sending when a Turn is already in-flight', async () => {
    server.use(
      trpcMsw.chat.get.query(() => []),
      sendAlreadyInflight(),
    );

    const { result } = renderChat();
    await waitFor(() =>
      expect(result.current.chat.isHistoryLoading).toBe(false),
    );

    act(() => result.current.chat.send('Hello'));

    // Sending, with the message shown exactly once — no duplicate optimistic
    // user Message, i.e. the hook attaches rather than re-sending.
    expect(result.current.chat.isSending).toBe(true);
    expect(
      result.current.chat.messages.filter(
        (m) => m.role === 'user' && m.text === 'Hello',
      ),
    ).toHaveLength(1);

    // When the attached reader later closes, an attached-only client owns no
    // Turn, so it must NOT reconcile/refund — no toast, unlike the orphan case.
    await waitFor(() => expect(result.current.chat.isSending).toBe(false));
    expect(screen.queryByText(/credits have been refunded/i)).toBeNull();
  });

  it('settles when stop() is called mid-Turn', async () => {
    server.use(
      trpcMsw.chat.get.query(() => []),
      sendAccepted(),
      trpcMsw.chat.stop.mutation(() => ({
        status: 'stopped' as const,
        turnId: TURN_ID,
      })),
    );

    const { result } = renderChat();
    await waitFor(() =>
      expect(result.current.chat.isHistoryLoading).toBe(false),
    );

    act(() => result.current.chat.send('Hello'));
    expect(result.current.chat.isSending).toBe(true);

    act(() => result.current.chat.stop());

    // chat.stop resolves → the hook settles the Turn → the send-gate reopens.
    await waitFor(() => expect(result.current.chat.isSending).toBe(false));
  });

  it('reconciles an orphaned stream and toasts the refund', async () => {
    server.use(
      trpcMsw.chat.get.query(() => []),
      sendAccepted(),
      trpcMsw.chat.reconcileTurn.mutation(() => ({ refunded: true })),
    );

    const { result } = renderChat();
    await waitFor(() =>
      expect(result.current.chat.isHistoryLoading).toBe(false),
    );

    act(() => result.current.chat.send('Hello'));

    // The jsdom reader closes with an unrecoverable error and no terminal — an
    // orphan. The hook fires chat.reconcileTurn and surfaces the refund toast,
    // asserted as DOM text through the real <ToastContainer />.
    expect(
      await screen.findByText(
        /credits have been refunded/i,
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
  });
});
