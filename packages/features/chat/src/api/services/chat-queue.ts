import type { SubscriptionTier } from '@acme/subscriptions';
import { createQueue, QUEUE_NAMES } from '@acme/queue';

export interface GenerationJob {
  conversationId: string;
  turnId: string;
  userId: string;
  tier: SubscriptionTier;
  query: string;
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
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });

// Exposed for tests: allows test suites to drain or inspect the queue without
// going through the enqueuer. Not exported from the package boundary.
export const _generationQueue = generationQueue;
