/**
 * Test Fixtures
 *
 * Factory helpers for feedback tests. Conversations and messages are persisted
 * by Mastra Memory, so fixtures seed via the memory API and return the generated
 * message id (needed to target feedback).
 */

import { memory } from '@acme/rag';
import { nsKey, redis } from '@acme/redis';

function generateId(): string {
  return crypto.randomUUID();
}

export function createTestUserId(suffix?: string): string {
  return `user_test_${suffix ?? generateId().slice(0, 8)}`;
}

export function createTestSessionId(): string {
  return generateId();
}

/**
 * Create a Conversation (Mastra Memory thread) in the test database.
 */
export async function createTestThread(
  opts: {
    sessionId?: string;
    userId?: string;
  } = {},
) {
  const sessionId = opts.sessionId ?? createTestSessionId();
  const userId = opts.userId ?? createTestUserId();

  await memory.createThread({
    threadId: sessionId,
    resourceId: userId,
    title: 'Test conversation',
  });

  return { sessionId, userId };
}

/**
 * Persist a single assistant Message and return its id (the feedback target).
 */
export async function createTestMessage(opts: {
  sessionId: string;
  userId: string;
  role?: 'user' | 'assistant';
  text?: string;
}) {
  const messageId = generateId();
  const role = opts.role ?? 'assistant';
  const text = opts.text ?? 'Test assistant reply';

  await memory.saveMessages({
    messages: [
      {
        id: messageId,
        role,
        createdAt: new Date(),
        threadId: opts.sessionId,
        resourceId: opts.userId,
        content: { format: 2, parts: [{ type: 'text', text }], content: text },
      },
    ],
  });

  return { messageId };
}

/**
 * Create a Conversation seeded with one assistant Message. Returns the ids a
 * feedback test needs: the owning user, the thread, and the message.
 */
export async function createTestThreadWithMessage(
  opts: {
    userId?: string;
    sessionId?: string;
  } = {},
) {
  const { sessionId, userId } = await createTestThread(opts);
  const { messageId } = await createTestMessage({ sessionId, userId });
  return { userId, sessionId, messageId };
}

export async function setupTestCredits(
  userId: string,
  tier: 'free' | 'pro' | 'enterprise' = 'free',
  remaining = 100,
): Promise<void> {
  const key = nsKey('credits', userId, tier);
  await redis.set(key, remaining.toString());
}
