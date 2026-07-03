/**
 * useChat — integration/hooks (ADR 0018).
 *
 * Drives the REAL useChat hook through a real QueryClient with the network
 * faked at the HTTP boundary (MSW via trpcMsw). Asserts returned state.
 *
 * SUBSCRIPTION CONSTRAINT: msw-trpc cannot intercept tRPC SSE subscriptions in
 * jsdom (`TypeError: opts.EventSource is not a constructor`). Paths that require
 * `send()` to succeed are covered with `onUnhandledRequest: 'bypass'` so the
 * subscription error is suppressed; we assert only the synchronous optimistic
 * state that send() writes BEFORE the subscription resolves. Streaming outcomes
 * (onData, onError, onConnectionStateChange) cannot be asserted here — they are
 * exercised via the component test (integration/components/chat-assistant.test.tsx).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type {
  Message,
  SelectMessageSchema,
} from '../../../../api/schemas/message-schema';
import { MAX_MESSAGE_LENGTH } from '../../../../api/schemas/chat-schema';
import { useChat } from '../../../../hooks/use-chat';
import { Providers, trpcMsw } from '../../setup';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

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
