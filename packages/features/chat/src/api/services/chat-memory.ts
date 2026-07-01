import { TRPCError } from '@trpc/server';

import type { OwnedThread } from '@acme/rag';
import { assertThreadOwned, memory, ThreadOwnershipError } from '@acme/rag';

import type { Message } from '../schemas/message-schema';

// The chat-memory adapter: the single seam between the chat feature and Mastra
// Memory. It owns the impedance-matching between Mastra's thread/message storage
// shape and the client-facing Conversation/Message contract, plus the thread
// ownership rule consumed by the ownership middleware. The Mastra vocabulary
// (thread, resource) is confined to this module; everything above speaks
// Conversation.

// A loaded, owned thread rendered in the chat feature's vocabulary. Aliases
// `@acme/rag`'s owned domain shape (`OwnedThread`) — the seam type, not a Mastra
// type — so the ownership middleware can inject the verified thread into the
// procedure context without the Mastra vocabulary crossing the boundary.
export type Conversation = OwnedThread;

type DBMessage = Awaited<ReturnType<typeof memory.recall>>['messages'][number];

// A thread (Mastra storage) rendered as the client-facing Conversation view.
export function toConversation(thread: Conversation) {
  return {
    sessionId: thread.id,
    userId: thread.resourceId,
    createdAt: thread.createdAt,
  };
}

// The Folder assignment carried on a thread's metadata. A single scalar, so a
// Conversation is in at most one Folder. Absent/non-string values read as null
// (un-foldered) — including a dangling id left behind by a deleted Folder, which
// the client simply fails to resolve and shows under a Date Bucket.
function folderIdOf(metadata: Conversation['metadata']) {
  const value = metadata?.folderId;
  return typeof value === 'string' ? value : null;
}

// A thread rendered as a Conversation History list row (no Messages loaded).
export function toConversationSummary(thread: Conversation) {
  return {
    sessionId: thread.id,
    title: thread.title ?? 'New conversation',
    updatedAt: thread.updatedAt,
    folderId: folderIdOf(thread.metadata),
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
// The ownership rule itself lives in `@acme/rag` (transport-agnostic); this
// thin caller maps its error onto tRPC's FORBIDDEN.
export async function loadOwnedConversation(sessionId: string, userId: string) {
  try {
    return await assertThreadOwned(sessionId, userId);
  } catch (error) {
    if (error instanceof ThreadOwnershipError) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have access to this chat session',
      });
    }
    throw error;
  }
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

// The id Mastra minted for the most recently persisted assistant turn in this
// Conversation. Sourced by re-reading the thread once the stream completes
// (rather than parsing Mastra's stream-result shape) so it stays robust across
// Mastra versions. Returns null when no assistant message exists yet. The
// `done` stream event carries this id so the client can attach feedback to the
// settled message without a refetch.
export async function latestAssistantMessageId(
  sessionId: string,
  userId: string,
) {
  const messages = await recallMessages(sessionId, userId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages.at(i);
    if (message?.role === 'assistant') return message.id;
  }
  return null;
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

// The caller's own Conversations for the history sidebar, most-recently-active
// first. The server owns the sort (`updatedAt DESC`); the client derives Date
// Buckets from `updatedAt` so the time/timezone-relative labels stay correct
// without a server round-trip.
export async function listConversationsForUser(userId: string) {
  const { threads } = await memory.listThreads({
    filter: { resourceId: userId },
    orderBy: { field: 'updatedAt', direction: 'DESC' },
    perPage: false,
  });
  return threads;
}

// Assign a Conversation to a Folder (or clear it with `folderId: null`). Mastra
// `updateThread` requires the title, so the loaded thread is passed through to
// preserve it. Existing metadata is spread so unrelated keys survive.
export async function setThreadFolder(
  thread: Conversation,
  folderId: string | null,
) {
  return memory.updateThread({
    id: thread.id,
    title: thread.title ?? 'New conversation',
    metadata: { ...thread.metadata, folderId },
  });
}
