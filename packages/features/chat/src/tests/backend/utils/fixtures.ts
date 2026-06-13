/**
 * Test Fixtures
 *
 * Factory functions for creating test data. Conversations and messages are now
 * persisted by Mastra Memory (threads/messages), so fixtures seed via the memory
 * API rather than a chat-owned table.
 */

import { memory } from '@acme/rag';
import { redis } from '@acme/redis';

/**
 * Generate a random UUID (v4-like format)
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Create a test user ID in Clerk format
 */
export function createTestUserId(suffix?: string): string {
  return `user_test_${suffix ?? generateId().slice(0, 8)}`;
}

/**
 * Create a test session ID
 */
export function createTestSessionId(): string {
  return generateId();
}

export interface CreateTestChatOptions {
  sessionId?: string;
  userId?: string;
}

/**
 * Create a Conversation (Mastra Memory thread) in the test database.
 */
export async function createTestChat(opts: CreateTestChatOptions = {}) {
  const sessionId = opts.sessionId ?? createTestSessionId();
  const userId = opts.userId ?? createTestUserId();

  await memory.createThread({
    threadId: sessionId,
    resourceId: userId,
    title: 'Test conversation',
  });

  return { sessionId, userId };
}

export interface CreateTestMessageOptions {
  sessionId: string;
  userId?: string;
  role?: 'user' | 'assistant';
  text?: string;
}

/**
 * Persist a single Message to a Conversation in the test database.
 */
export async function createTestMessage(opts: CreateTestMessageOptions) {
  const role = opts.role ?? 'user';
  const text = opts.text ?? 'Test message';

  await memory.saveMessages({
    messages: [
      {
        id: generateId(),
        role,
        createdAt: new Date(),
        threadId: opts.sessionId,
        resourceId: opts.userId,
        content: { format: 2, parts: [{ type: 'text', text }], content: text },
      },
    ],
  });

  return { sessionId: opts.sessionId, role, text };
}

/**
 * Create a Conversation pre-seeded with alternating user/assistant Messages.
 */
export async function createTestChatWithMessages(opts: {
  userId?: string;
  sessionId?: string;
  messageCount?: number;
}) {
  const chat = await createTestChat({
    userId: opts.userId,
    sessionId: opts.sessionId,
  });

  const messageCount = opts.messageCount ?? 2;
  const createdMessages = [];

  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const msg = await createTestMessage({
      sessionId: chat.sessionId,
      userId: chat.userId,
      role,
      text: `Test message ${i + 1}`,
    });
    createdMessages.push(msg);
  }

  return { chat, messages: createdMessages };
}

/**
 * Set up Redis credits for a test user
 */
export async function setupTestCredits(
  userId: string,
  tier: 'free' | 'pro' | 'enterprise' = 'free',
  remaining = 100,
): Promise<void> {
  const key = `credits:${userId}:${tier}`;
  await redis.set(key, remaining.toString());
}

/**
 * Get current credit count for a test user
 */
export async function getTestCredits(
  userId: string,
  tier: 'free' | 'pro' | 'enterprise' = 'free',
): Promise<number> {
  const key = `credits:${userId}:${tier}`;
  const value = await redis.get(key);
  return value ? Number(value) : 0;
}
