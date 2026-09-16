import type { SubscriptionTier } from '@acme/entitlements';
import { createQueue, QUEUE_NAMES } from '@acme/queue';

import { env } from '../../env';

export interface GenerationJob {
  conversationId: string;
  turnId: string;
  userId: string;
  tier: SubscriptionTier;
  query: string;
  /**
   * The Data Sources this Turn may retrieve from, as validated by `chat.send`
   * against the caller's own Sources — unowned and unknown ids are already
   * dropped. The worker does NOT read the selection off the thread: "per-Turn"
   * means the scope is validated at every send and travels with the job.
   *
   * Still re-asserted at use, in `resolveRetrievalScope`. The two checks answer
   * different questions: this one asked "are these yours?" at send time, the
   * other asks "are these still yours?" when the Turn actually runs. A brand
   * proving the first would not survive BullMQ's JSON boundary anyway.
   */
  dataSourceIds: string[];
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
