import { TRPCError } from '@trpc/server';

import { memory } from '@acme/rag';

import type { Message } from '../schemas/message-schema';

// The chat-memory adapter: the single seam between the chat feature and Mastra
// Memory. It owns the impedance-matching between Mastra's thread/message storage
// shape and the client-facing Conversation/Message contract, plus the thread
// ownership rule consumed by the ownership middleware. The Mastra vocabulary
// (thread, resource) is confined to this module; everything above speaks
// Conversation.

// A loaded Mastra thread. Exposed so the ownership middleware can inject the
// verified thread into the procedure context.
export type Conversation = NonNullable<
  Awaited<ReturnType<typeof memory.getThreadById>>
>;

type DBMessage = Awaited<ReturnType<typeof memory.recall>>['messages'][number];

// A thread (Mastra storage) rendered as the client-facing Conversation view.
export function toConversation(thread: Conversation) {
  return {
    sessionId: thread.id,
    userId: thread.resourceId,
    createdAt: thread.createdAt,
  };
}

function partsToText(content: DBMessage['content']) {
  if (typeof content === 'string') return content;
  let text = '';
  for (const part of content.parts) {
    if (part.type === 'text') text += part.text;
  }
  if (!text && typeof content.content === 'string') text = content.content;
  return text;
}

// Stored Mastra messages rendered as the ordered client-facing Message list.
export function toMessages(
  dbMessages: DBMessage[],
  sessionId: string,
): Message[] {
  return dbMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      id: m.id,
      sessionId,
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      text: partsToText(m.content),
      timestamp: m.createdAt,
    }));
}

// Load a Conversation and enforce ownership. Returns null when the thread does
// not exist yet (the stream/create procedures operate before the thread is
// stamped). Throws FORBIDDEN when the thread is owned by another user — the
// security invariant the ownership middleware seats at the request pipeline.
export async function loadOwnedConversation(sessionId: string, userId: string) {
  const thread = await memory.getThreadById({ threadId: sessionId });
  if (!thread) return null;
  if (thread.resourceId !== userId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this chat session',
    });
  }
  return thread;
}

export async function createConversation(sessionId: string, userId: string) {
  return memory.createThread({
    threadId: sessionId,
    resourceId: userId,
    title: 'New conversation',
  });
}

export async function deleteConversation(sessionId: string) {
  await memory.deleteThread(sessionId);
}

export async function recallMessages(sessionId: string, userId: string) {
  const { messages } = await memory.recall({
    threadId: sessionId,
    resourceId: userId,
    perPage: false,
  });
  return messages;
}

// Admin bypass: read any Conversation without an ownership check. Named
// explicitly so the unguarded access is visible, never a raw memory call
// lurking in a procedure.
export async function getConversationUnchecked(sessionId: string) {
  return memory.getThreadById({ threadId: sessionId });
}

// Admin bypass: list every Conversation owned by a given user.
export async function listConversations(userId: string) {
  const { threads } = await memory.listThreads({
    filter: { resourceId: userId },
    perPage: false,
  });
  return threads;
}
