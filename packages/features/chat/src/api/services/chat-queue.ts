import type { SubscriptionTier } from '@acme/entitlements';
import { createQueue, QUEUE_NAMES } from '@acme/queue';

import type { RecordedSources } from '../schemas/message-source-schema';
import { env } from '../../env';

export interface GenerationJob {
  conversationId: string;
  turnId: string;
  userId: string;
  tier: SubscriptionTier;
  query: string;
  /**
   * The Turn's Source Selection, already narrowed by `chat.send` to the
   * caller's own Sources, and carrying each Source's NAME beside its id.
   *
   * Names travel because the worker writes the per-Message receipt, and a
   * receipt has to survive the Source being deleted. So the job carries one
   * clump rather than ids for retrieval plus names for the record: two fields
   * for one selection is how the two drift, and the drift would be a receipt
   * that disagrees with what was retrieved.
   *
   * The worker does NOT read the selection off the thread — "per-Turn" means
   * the scope is resolved at every send and travels with the job. It is
   * narrowed AGAIN at use, in `resolveRetrievalScope`. The two passes answer
   * different questions: this one asked "which of these are yours?" at send
   * time, the other asks "which are still yours?" when the Turn actually runs.
   * A brand proving the first would not survive BullMQ's JSON boundary anyway.
   */
  dataSources: RecordedSources;
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
