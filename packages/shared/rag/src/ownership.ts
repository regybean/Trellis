import { memory } from './memory';

// Transport-agnostic thread ownership rule. Mastra Memory stamps each thread's
// `resourceId` with the owning userId; this is the single place that vocabulary
// is compared against a caller. Returns the thread when owned, `null` when the
// thread does not exist yet, and throws `ThreadOwnershipError` when it belongs
// to someone else. Callers map the error to their transport (e.g. a feature
// maps it to a tRPC FORBIDDEN) — `@acme/rag` stays free of any transport.

// A loaded thread, owned by the caller. This is `@acme/rag`'s OWN domain shape,
// not a Mastra type: the seam exposes only the fields callers consume, so a
// replacement memory store need only satisfy this interface — Mastra's
// `StorageThreadType` (and any other internal type) never crosses the boundary.
export interface OwnedThread {
  id: string;
  // The owning userId (Mastra stamps this as `resourceId`).
  resourceId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
  // Free-form per-thread metadata (e.g. the chat feature's `folderId`).
  metadata?: Record<string, unknown>;
}

export class ThreadOwnershipError extends Error {
  readonly threadId: string;
  constructor(threadId: string) {
    super(`Thread ${threadId} is owned by another user`);
    this.name = 'ThreadOwnershipError';
    this.threadId = threadId;
  }
}

// Narrow a Mastra thread onto the owned domain shape. Confines the Mastra
// vocabulary to this module so nothing above the seam depends on it.
function toOwnedThread(
  thread: NonNullable<Awaited<ReturnType<typeof memory.getThreadById>>>,
): OwnedThread {
  return {
    id: thread.id,
    resourceId: thread.resourceId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    metadata: thread.metadata,
  };
}

export async function assertThreadOwned(
  threadId: string,
  userId: string,
): Promise<OwnedThread | null> {
  const thread = await memory.getThreadById({ threadId });
  if (!thread) return null;
  if (thread.resourceId !== userId) throw new ThreadOwnershipError(threadId);
  return toOwnedThread(thread);
}
