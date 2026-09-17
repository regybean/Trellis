import { and, asc, eq } from 'drizzle-orm';

import { logger } from '@acme/logger';

import type { RecordedSources } from '../schemas/message-source-schema';
import {
  messageDataSource,
  selectMessageSourcesSchema,
} from '../schemas/message-source-schema';
import { db } from '../trpc';

/**
 * The per-Message Source receipt: every read and write of
 * `message_data_source`, in one module.
 *
 * Kept out of the router for the same reason `assertFolderOwned` is: the table
 * is only ever queried through here, so there is no naked Drizzle query in a
 * router body. Unlike Folders, this one has a second caller that is not a
 * router at all — the Generation worker writes the row, because Mastra mints
 * the assistant `messageId` during streaming.
 */

interface RecordTurnSourcesInput {
  messageId: string;
  conversationId: string;
  ownerId: string;
  sources: RecordedSources;
}

/**
 * Write one Turn's receipt against the assistant Message that settled it.
 *
 * `sources` is the set `chat.send` validated and handed to the job — not
 * something the worker went and read. The empty array is written as an empty
 * array, deliberately: "zero Sources, chosen" has to be distinguishable from
 * "no record at all", because the sticky empty set depends on telling them
 * apart.
 *
 * **Fail-soft, and that is a decision rather than an oversight.** By the time
 * this runs the assistant Message is persisted and the user has been charged
 * for a Turn that worked. Letting a receipt write take the Turn down would
 * convert a missing disclosure into a refunded error on an answer the user can
 * see, and re-ordering it earlier only moves the same problem. So a failure is
 * logged loudly and swallowed: the Turn keeps its answer, that Message shows no
 * disclosure, and the sticky set reads through to the previous Turn — the same
 * degradation as a pre-feature Message. Nothing widens; the scope that applied
 * was applied by the filter, not by this row.
 */
export async function recordTurnSources({
  messageId,
  conversationId,
  ownerId,
  sources,
}: RecordTurnSourcesInput) {
  try {
    await db.insert(messageDataSource).values({
      messageId,
      threadId: conversationId,
      ownerId,
      sources,
    });
    logger.debug(
      { conversationId, messageId, sourceCount: sources.length },
      'chat: turn sources recorded',
    );
  } catch (error) {
    logger.error(
      { err: error, conversationId, messageId },
      'chat: failed to record turn sources — the Turn keeps its answer, this Message loses its disclosure',
    );
  }
}

/**
 * One Conversation's receipts, oldest first, scoped to the owner as well as the
 * thread.
 *
 * The owner predicate is redundant today — every caller has already been
 * through the Conversation-ownership builder — and it stays because this table
 * is the one place the transcript's claim about retrieval scope is stored, and
 * a reviewer checking that boundary should not have to leave the query to do
 * it.
 *
 * Oldest first, and the whole Conversation rather than just the tail, because
 * one read serves both consumers: the per-Message disclosure looks its own
 * Message up by id, and the sticky selection takes the last entry. Splitting
 * that into a list read plus a `LIMIT 1` "latest" read would be two round trips
 * for one screen, and the two could disagree.
 */
export async function listConversationSources({
  conversationId,
  ownerId,
}: {
  conversationId: string;
  ownerId: string;
}) {
  const rows = await db
    .select({
      messageId: messageDataSource.messageId,
      sources: messageDataSource.sources,
    })
    .from(messageDataSource)
    .where(
      and(
        eq(messageDataSource.threadId, conversationId),
        eq(messageDataSource.ownerId, ownerId),
      ),
    )
    .orderBy(asc(messageDataSource.createdAt));

  return rows.map((row) => selectMessageSourcesSchema.parse(row));
}
