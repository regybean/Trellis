/**
 * Chat-memory adapter — transform unit tests.
 *
 * The thread↔Conversation and stored-message↔Message transforms are pure, so
 * they are exercised here with fixtures rather than implicitly through the
 * router. Ownership and the Mastra-backed mutations are covered by the router
 * suite (they need a live thread store).
 */
import { describe, expect, it } from 'vitest';

import { toConversation, toMessages } from '../../../api/services/chat-memory';

type Thread = Parameters<typeof toConversation>[0];
type DBMessage = Parameters<typeof toMessages>[0][number];

function makeThread(overrides: Partial<Thread> = {}) {
  return {
    id: 'session-1',
    resourceId: 'user-1',
    title: 'New conversation',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    metadata: {},
    ...overrides,
  } as unknown as Thread;
}

function makeMessage(
  overrides: {
    id?: string;
    role?: string;
    content?: unknown;
    createdAt?: Date;
  } = {},
) {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'hello',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as DBMessage;
}

describe('toConversation', () => {
  it('maps a thread to the client-facing Conversation view', () => {
    const thread = makeThread({
      id: 'abc',
      resourceId: 'user-9',
      createdAt: new Date('2026-02-02T00:00:00Z'),
    });

    expect(toConversation(thread)).toEqual({
      sessionId: 'abc',
      userId: 'user-9',
      createdAt: new Date('2026-02-02T00:00:00Z'),
    });
  });
});

describe('toMessages', () => {
  it('renders user and assistant turns in order with the session id stamped', () => {
    const messages = toMessages(
      [
        makeMessage({ id: 'm1', role: 'user', content: 'hi' }),
        makeMessage({ id: 'm2', role: 'assistant', content: 'hello back' }),
      ],
      'session-x',
    );

    expect(messages).toEqual([
      expect.objectContaining({
        id: 'm1',
        sessionId: 'session-x',
        role: 'user',
        text: 'hi',
      }),
      expect.objectContaining({
        id: 'm2',
        sessionId: 'session-x',
        role: 'assistant',
        text: 'hello back',
      }),
    ]);
  });

  it('drops non-user/assistant roles (e.g. system, tool)', () => {
    const messages = toMessages(
      [
        makeMessage({ id: 'm1', role: 'system', content: 'prompt' }),
        makeMessage({ id: 'm2', role: 'user', content: 'hi' }),
      ],
      'session-x',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 'm2', role: 'user' });
  });

  it('extracts text from a structured parts payload', () => {
    const messages = toMessages(
      [
        makeMessage({
          id: 'm1',
          role: 'assistant',
          content: {
            parts: [
              { type: 'text', text: 'one ' },
              { type: 'text', text: 'two' },
            ],
            content: '',
          },
        }),
      ],
      'session-x',
    );

    expect(messages[0]?.text).toBe('one two');
  });

  it('falls back to content.content when parts carry no text', () => {
    const messages = toMessages(
      [
        makeMessage({
          id: 'm1',
          role: 'assistant',
          content: { parts: [], content: 'fallback' },
        }),
      ],
      'session-x',
    );

    expect(messages[0]?.text).toBe('fallback');
  });
});
