import type { SubscriptionTier } from '@acme/entitlements';
import type { SourceSelection } from '@acme/rag/schema';
import { createQueue, QUEUE_NAMES } from '@acme/queue';

import { env } from '../../env';

export interface GenerationJob {
  conversationId: string;
  turnId: string;
  userId: string;
  tier: SubscriptionTier;
  query: string;
  /**
   * The Turn's Source Selection (rag's `SourceSelection`), already narrowed by
   * `chat.send` to the caller's own Sources. The worker does NOT read the
   * selection off the thread: "per-Turn" means the scope is resolved at every
   * send and travels with the job.
   *
   * Narrowed AGAIN at use, in `resolveRetrievalScope`. The two passes answer
   * different questions: this one asked "which of these are yours?" at send
   * time, the other asks "which are still yours?" when the Turn actually runs.
   * A brand proving the first would not survive BullMQ's JSON boundary anyway.
   */
  dataSourceIds: SourceSelection;
}

// Singleton queue — module-private. enqueueGenerationTurn is the only call site
// that may add to this queue; the sole-enqueuer constraint is structural.
const generationQueue = createQueue<GenerationJob>(QUEUE_NAMES.GENERATION);

// jobId = conversationId.turnId deduplicates enqueues at the BullMQ level,
// complementing the In-flight lock that enforces one-in-flight per Conversation
// at the domain level. BullMQ forbids ':' in a custom job id (it delimits its
// own Redis key namespace), so the two UUIDs are joined with '.'.
export const generationJobId = (conversationId: string, turnId: string) =>
  `${conversationId}.${turnId}`;

export const enqueueGenerationTurn = (job: GenerationJob) =>
  generationQueue.add('generate', job, {
    jobId: generationJobId(job.conversationId, job.turnId),
    removeOnComplete: env.QUEUE_REMOVE_ON_COMPLETE,
    removeOnFail: env.QUEUE_REMOVE_ON_FAIL,
  });

// Exposed for tests: allows test suites to drain or inspect the queue without
// going through the enqueuer. Not exported from the package boundary.
export const _generationQueue = generationQueue;
