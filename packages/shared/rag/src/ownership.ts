import { memory } from './memory';

// Transport-agnostic thread ownership rule. Mastra Memory stamps each thread's
// `resourceId` with the owning userId; this is the single place that vocabulary
// is compared against a caller. Returns the thread when owned, `null` when the
// thread does not exist yet, and throws `ThreadOwnershipError` when it belongs
// to someone else. Callers map the error to their transport (e.g. a feature
// maps it to a tRPC FORBIDDEN) — `@acme/rag` stays free of any transport.

// A loaded Mastra thread, owned by the caller.
export type OwnedThread = NonNullable<
  Awaited<ReturnType<typeof memory.getThreadById>>
>;

export class ThreadOwnershipError extends Error {
  readonly threadId: string;
  constructor(threadId: string) {
    super(`Thread ${threadId} is owned by another user`);
    this.name = 'ThreadOwnershipError';
    this.threadId = threadId;
  }
}

export async function assertThreadOwned(
  threadId: string,
  userId: string,
): Promise<OwnedThread | null> {
  const thread = await memory.getThreadById({ threadId });
  if (!thread) return null;
  if (thread.resourceId !== userId) throw new ThreadOwnershipError(threadId);
  return thread;
}
