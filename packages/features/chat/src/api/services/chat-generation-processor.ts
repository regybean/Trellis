import type { EntitlementsProvider } from '@acme/entitlements';
import type { Job } from '@acme/queue';
import { logger } from '@acme/logger';

import type { RecordedSources } from '../schemas/message-source-schema';
import type { GenerationJob } from './chat-queue';
import type { TurnTerminalKind } from './chat-turn-lifecycle';
import { generateThreadTitle, persistAssistantMessage } from './chat-memory';
import { createStreamWriter } from './chat-stream';
import {
  isTurnAborted,
  refundTurnCredits,
  settleTurn,
} from './chat-turn-lifecycle';
import { streamScopedTurn } from './chat-turn-stream';
import { recordTurnSources } from './message-sources';

// The Stream's producer seam is the writer (chat-stream-writer.ts): it owns
// every `xAdd`, the wire shape, and the safety TTL. The lock/abort TTLs and the
// terminal teardown (`settleTurn`) live in chat-turn-lifecycle, the one home for
// the Turn control plane.
type StreamWriter = ReturnType<typeof createStreamWriter>;

// What an assistant Message needs to settle: the text, and the Source Selection
// the Turn ran under. Bundled because the two always travel together now — a
// settled Message and its receipt are written as one step.
interface SettleAssistantInput {
  conversationId: string;
  userId: string;
  text: string;
  dataSources: RecordedSources;
}

/**
 * Persist the assistant Message and, against the id Mastra just minted, the
 * receipt naming what this Turn was scoped to.
 *
 * The receipt is keyed on the ASSISTANT Message, which is why it is written
 * here and not by `chat.send`: the id does not exist until the Turn settles.
 * The set written is the one `chat.send` validated and put in the job payload,
 * so the worker is using what it was handed rather than trusting stored state.
 *
 * Written BEFORE the terminal, deliberately. A client invalidates its receipt
 * read when the terminal arrives, so writing after would race its refetch and
 * leave the newest Message with no disclosure until something else refreshed
 * it.
 *
 * The empty selection writes an empty array rather than nothing, which is what
 * makes "asked with no Sources" distinguishable from "no record at all". Only
 * the paths that persist a Message call this, so a Turn that failed leaves no
 * row and the sticky set reads through to the previous one.
 */
async function settleAssistantMessage({
  conversationId,
  userId,
  text,
  dataSources,
}: SettleAssistantInput) {
  const messageId = await persistAssistantMessage(conversationId, userId, text);
  await recordTurnSources({
    messageId,
    conversationId,
    ownerId: userId,
    sources: dataSources,
  });
  return messageId;
}

// Persist any non-empty partial and close with the `cancelled` terminal (carrying
// the minted messageId iff a partial persisted). A cancelled Turn that kept a
// partial gets a receipt like any other settled Message: retrieval could have
// happened, the disclosure renders on it, and the scope it ran under is the same
// one the next Turn inherits. Teardown (lock release, post-terminal TTL) is left
// to the processor's `finally`, which runs on the abort `return` path too.
async function handleAbort(writer: StreamWriter, input: SettleAssistantInput) {
  logger.info(
    { conversationId: input.conversationId },
    'generation worker: abort received',
  );

  await writer.cancelled(
    input.text ? await settleAssistantMessage(input) : null,
  );
}

// Factory for the BullMQ job processor. It closes over an injected
// `EntitlementsProvider` so the request-less worker refunds through the SAME
// seam the request path does
// ([ADR 0006](../../../docs/adr/0006-credits-metered-in-the-turn-control-plane.md)):
// each app's worker entrypoint (apps/*/worker.ts) injects the exact provider
// its route handler injects — full apps `subscriptionsEntitlements`, slim apps
// `unlimitedEntitlements`. Ownership was asserted by chat.send before
// enqueueing; userId from the job payload stamps resourceId for Mastra. See
// [ADR 0004](../../../docs/adr/0004-generation-worker-and-queue.md).
export function createChatGenerationProcessor(
  entitlements: EntitlementsProvider,
) {
  return async function chatGenerationProcessor(job: Job<GenerationJob>) {
    return runGenerationTurn(entitlements, job);
  };
}

async function runGenerationTurn(
  entitlements: EntitlementsProvider,
  job: Job<GenerationJob>,
) {
  const { conversationId, turnId, userId, tier, query, dataSources } = job.data;
  const writer = createStreamWriter(conversationId);
  // The terminal this Turn settled on — the worker names it for `settleTurn` in
  // the `finally`. Defaults to `error` (the catch path); the success and abort
  // paths overwrite it. The teardown is uniform across the three, so a title
  // failure after `done` flips it to `error` with no observable difference.
  let terminal: TurnTerminalKind = 'error';

  logger.info({ conversationId, turnId }, 'generation worker: starting');

  try {
    // Retrieval is scoped to the Sources `chat.send` narrowed to, and the
    // wrapper narrows again before building anything — so a Source deleted
    // since the send is dropped here and the Turn still answers. Streaming goes
    // through `streamScopedTurn` and nowhere else; the direct
    // `chatAgent.stream` call this replaced is now a lint error.
    const result = await streamScopedTurn({
      conversationId,
      userId,
      query,
      // The wrapper wants the scope, not the receipt: names are for the row
      // this Turn writes, and rag must not be handed a label it would have to
      // decide whether to trust.
      dataSourceIds: dataSources.map((source) => source.id),
    });

    let accumulated = '';
    const aborted = () => isTurnAborted({ conversationId, turnId });
    const settleInput = () => ({
      conversationId,
      userId,
      text: accumulated,
      dataSources,
    });

    for await (const chunk of result.textStream) {
      // Accumulate and publish the delta first, THEN honour an abort — so the
      // chunk in flight is included in the persisted partial rather than
      // discarded. Checking before the append would drop the current token. The
      // writer stamps the safety TTL on this first write.
      accumulated += chunk;
      await writer.delta(chunk);

      if (await aborted()) {
        await handleAbort(writer, settleInput());
        terminal = 'cancelled';
        return;
      }
    }

    // An abort that arrived before/around an empty stream is caught here, so it
    // yields a `cancelled` terminal (empty ⇒ no messageId) rather than `done`.
    if (await aborted()) {
      await handleAbort(writer, settleInput());
      terminal = 'cancelled';
      return;
    }

    // Clean completion: persist the assistant Message and its receipt, then
    // close with the done terminal carrying the id the persist just minted (no
    // full-thread recall).
    const messageId = await settleAssistantMessage(settleInput());
    await writer.done(messageId);
    terminal = 'done';

    // On the first Turn, generate the thread title from the initial query. The
    // adapter owns the first-Turn check + Mastra write.
    await generateThreadTitle(conversationId, query);

    logger.info({ conversationId, turnId }, 'generation worker: done');
  } catch (error) {
    logger.error(
      { err: error, conversationId, turnId },
      'generation worker: error',
    );

    await writer.error();
    await refundTurnCredits(
      (uid, creditTier, amount) => entitlements.refund(uid, creditTier, amount),
      userId,
      tier,
      turnId,
    );
    // `terminal` keeps its `error` default here — the settleTurn teardown reads it.
  } finally {
    await settleTurn(terminal, { conversationId, turnId });
  }
}
