import type { OwnedThread } from '@acme/rag';
import { memory } from '@acme/rag';

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

// The sentinel title a thread carries until a real title is generated from its
// first user Message. One definition, referenced by summary rendering, thread
// creation, folder-preserving updates, and first-Turn detection — so the
// sentinel can never drift between the sites that compare against it.
export const NEW_CONVERSATION_TITLE = 'New conversation';

// First-Turn detection. A Conversation is on its first Turn while its thread
// still carries the sentinel title (or none) — no title has been generated yet.
// Pure over the title so it is unit-testable without a live thread store; owned
// here so the Generation worker never re-derives the rule.
export function isFirstTurn(title?: string) {
  return !title || title === NEW_CONVERSATION_TITLE;
}

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
    title: thread.title ?? NEW_CONVERSATION_TITLE,
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

export async function createConversation(sessionId: string, userId: string) {
  return memory.createThread({
    threadId: sessionId,
    resourceId: userId,
    title: NEW_CONVERSATION_TITLE,
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

// The single `saveMessages` envelope. Both the user Message (persisted by
// `chat.send` before the first token) and the assistant Message (persisted by
// the Generation worker on terminal) go through here, so the Mastra stored-
// message shape has exactly one definition. `resourceId = userId` is what makes
// the row the caller's own.
async function saveMessage(
  role: 'user' | 'assistant',
  sessionId: string,
  userId: string,
  text: string,
) {
  await memory.saveMessages({
    messages: [
      {
        id: crypto.randomUUID(),
        role,
        createdAt: new Date(),
        threadId: sessionId,
        resourceId: userId,
        content: { format: 2, parts: [{ type: 'text', text }], content: text },
      },
    ],
  });
}

// Persist the user's Message explicitly, before any token is generated, so it
// is durable in `chat.get` the moment `chat.send` accepts — the durable-stream
// flow drives generation from a worker (readOnly memory), so nothing else
// writes the user turn.
export async function persistUserMessage(
  sessionId: string,
  userId: string,
  text: string,
) {
  await saveMessage('user', sessionId, userId, text);
}

// Persist the assistant's Message on a terminal, driven by the Generation
// worker: `done` → full text, `cancelled` → non-empty partial. The worker owns
// the terminal policy (empty ⇒ no persist, `error` ⇒ nothing); the adapter owns
// the write so raw Mastra vocabulary never leaks into the worker.
export async function persistAssistantMessage(
  sessionId: string,
  userId: string,
  text: string,
) {
  await saveMessage('assistant', sessionId, userId, text);
}

// The id of the most-recently-persisted assistant Message, found by scanning
// recall newest-first. The Generation worker puts this id on the `done` /
// `cancelled` terminal so clients (e.g. feedback) can key off the settled
// Message. Lives here — the only seam to Mastra recall — not in the worker.
export async function latestAssistantMessageId(
  sessionId: string,
  userId: string,
) {
  const messages = await recallMessages(sessionId, userId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'assistant') return m.id;
  }
  return null;
}

// Generate and persist a thread's title from its first user Message — a no-op
// unless the Conversation is still on its first Turn. Encapsulates the
// thread read + first-Turn check + update so the worker drives title generation
// without touching Mastra directly. Mastra requires the title on `updateThread`
// and existing metadata is preserved.
export async function generateThreadTitle(sessionId: string, query: string) {
  const thread = await memory.getThreadById({ threadId: sessionId });
  if (!isFirstTurn(thread?.title)) return;
  await memory.updateThread({
    id: sessionId,
    title: query.slice(0, 80),
    metadata: thread?.metadata ?? {},
  });
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
    title: thread.title ?? NEW_CONVERSATION_TITLE,
    metadata: { ...thread.metadata, folderId },
  });
}
