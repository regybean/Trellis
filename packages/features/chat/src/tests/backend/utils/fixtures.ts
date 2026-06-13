/**
 * Test Fixtures
 *
 * Factory functions for creating test data. These help create consistent
 * test data with sensible defaults that can be overridden as needed.
 */

import { redis } from '@acme/redis';

import type { InsertChatSchema } from '../../../api/schemas/chat-schema';
import type { SelectMessageSchema } from '../../../api/schemas/message-schema';
import { chats } from '../../../api/schemas/chat-schema';
import { messages } from '../../../api/schemas/message-schema';
import { db } from '../../../api/trpc';

// Type for message data we create (subset of SelectMessageSchema)
type TestMessageData = Omit<SelectMessageSchema, 'timestamp'>;

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

/**
 * Options for creating a test chat
 */
export interface CreateTestChatOptions {
  sessionId?: string;
  userId?: string;
}

/**
 * Create a chat record in the test database
 *
 * @example
 * ```ts
 * const chat = await createTestChat({ userId: 'user_123' });
 * ```
 */
export async function createTestChat(
  opts: CreateTestChatOptions = {},
): Promise<InsertChatSchema & { sessionId: string; userId: string }> {
  const chatData = {
    sessionId: opts.sessionId ?? createTestSessionId(),
    userId: opts.userId ?? createTestUserId(),
  };

  const [inserted] = await db.insert(chats).values(chatData).returning();

  if (!inserted) {
    throw new Error('Failed to create test chat');
  }

  return inserted as InsertChatSchema & { sessionId: string; userId: string };
}

/**
 * Options for creating a test message
 */
export interface CreateTestMessageOptions {
  sessionId: string;
  role?: 'user' | 'assistant';
  text?: string;
}

/**
 * Create a message record in the test database
 *
 * @example
 * ```ts
 * const msg = await createTestMessage({
 *   sessionId: chat.sessionId,
 *   role: 'user',
 *   text: 'Hello!'
 * });
 * ```
 */
export async function createTestMessage(
  opts: CreateTestMessageOptions,
): Promise<TestMessageData> {
  const messageData = {
    sessionId: opts.sessionId,
    role: opts.role ?? 'user',
    text: opts.text ?? 'Test message',
  };

  const [inserted] = await db.insert(messages).values(messageData).returning();

  if (!inserted) {
    throw new Error('Failed to create test message');
  }

  return inserted;
}

/**
 * Create a complete chat with messages for testing
 *
 * @example
 * ```ts
 * const { chat, messages } = await createTestChatWithMessages({
 *   userId: 'user_123',
 *   messageCount: 5
 * });
 * ```
 */
export async function createTestChatWithMessages(opts: {
  userId?: string;
  sessionId?: string;
  messageCount?: number;
}): Promise<{
  chat: InsertChatSchema & { sessionId: string; userId: string };
  messages: TestMessageData[];
}> {
  const chat = await createTestChat({
    userId: opts.userId,
    sessionId: opts.sessionId,
  });

  const messageCount = opts.messageCount ?? 2;
  const createdMessages: TestMessageData[] = [];

  for (let i = 0; i < messageCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const msg = await createTestMessage({
      sessionId: chat.sessionId,
      role,
      text: `Test message ${i + 1}`,
    });
    createdMessages.push(msg);
  }

  return { chat, messages: createdMessages };
}

/**
 * Set up Redis credits for a test user
 *
 * @example
 * ```ts
 * await setupTestCredits('user_123', 'free', 100);
 * ```
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
