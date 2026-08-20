import type { SubscriptionTier } from '@acme/entitlements';
import { createQueue, QUEUE_NAMES } from '@acme/queue';

import { chatConfig } from '../../config';
import { configContext } from '../../env';

// BullMQ job-retention counts are config-as-code (ADR 0026).
const config = chatConfig(configContext);

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
    removeOnComplete: config.QUEUE_REMOVE_ON_COMPLETE,
    removeOnFail: config.QUEUE_REMOVE_ON_FAIL,
  });

// Exposed for tests: allows test suites to drain or inspect the queue without
// going through the enqueuer. Not exported from the package boundary.
export const _generationQueue = generationQueue;
