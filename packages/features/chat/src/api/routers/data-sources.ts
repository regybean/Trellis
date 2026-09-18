import { mapDataSourceError } from '@acme/rag/ownership-trpc';
import { CreateDataSourceRequest } from '@acme/rag/schema';
import {
  createDataSource,
  listDataSources,
  listDocuments,
} from '@acme/rag/server';

import { MessageSourcesRequest } from '../schemas/message-source-schema';
import { listConversationSources } from '../services/message-sources';
import {
  createTRPCRouter,
  ownedConversationByIdProcedure,
  protectedProcedure,
} from '../trpc';

/**
 * Chat's Data Source surface: the Sources the composer panel offers, the inline
 * create it offers alongside them, and the per-Message receipts the transcript
 * discloses.
 *
 * The first two are thin calls into `@acme/rag/server`, duplicating ingest's
 * `dataSources.list` / `dataSources.create` on purpose. `features → features`
 * is illegal and rag has no router, so each feature wires rag's functions
 * itself. What matters is that the POLICY is not duplicated: the ownership
 * predicate, the name rule and the per-user cap all live in rag, so neither
 * router adds any of its own and the two cannot disagree.
 *
 * `records` is chat's alone. It reads `message_data_source`, a chat-owned
 * table, through the receipt module.
 */
export const dataSourcesRouter = createTRPCRouter({
  /**
   * The caller's own Data Sources, oldest first — the panel's checkbox rows.
   *
   * Used for EXISTENCE, not for names. The composer tooltip and "Sources
   * included" read names from the per-Message receipt instead, because this
   * query is persisted and a surface that asserts what a question was exposed
   * to must not be able to render a name off a stale cache. What this read is
   * for is the reconciliation: an id the caller no longer owns unticks itself
   * the moment this settles.
   */
  list: protectedProcedure.query(({ ctx }) =>
    listDataSources({ ownerId: ctx.session.user.id }),
  ),

  /**
   * How many Documents each of the caller's Sources holds — the number beside
   * each checkbox row in the composer panel.
   *
   * Separate from `list` rather than folded into it, for two different reasons
   * that happen to agree. `list` is persisted, and a count is the one field on
   * a Source row that goes stale within a session, so baking it in would either
   * paint a wrong number from IndexedDB or force the list off the persister and
   * back into a cold-open spinner. And `list`'s shape is deliberately rag's own
   * row, so that ingest's `dataSources.list` and this one stay the same read.
   *
   * Counts are advisory: they tell the user which Source is worth ticking, and
   * nothing about what a Turn may retrieve. Only the server-built filter
   * decides that, so a stale count here cannot widen a scope.
   *
   * One grouped query, not one per Source. rag's roll-up already groups by
   * Source and filename, so the Document count is the row count per Source —
   * the same derivation ingest's rail makes from its own roll-up.
   */
  documentCounts: protectedProcedure.query(async ({ ctx }) => {
    const rows = await listDocuments({ ownerId: ctx.session.user.id });

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.dataSourceId, (counts.get(row.dataSourceId) ?? 0) + 1);
    }

    return [...counts].map(([dataSourceId, documentCount]) => ({
      dataSourceId,
      documentCount,
    }));
  }),

  /**
   * Create a Data Source under a client-minted id, so a panel row can appear
   * optimistically and still reconcile 1:1 with the server row. Safe only
   * because the retrieval filter's first clause is
   * `owner_id = <verified userId>`.
   *
   * The composer needs this because a user who realises mid-conversation that
   * they have nowhere to put a document should not have to leave the
   * conversation to fix it. The cap is enforced inside rag's function, so this
   * procedure adds no policy of its own — a second expression of the number
   * here would be one to keep in step with ingest's create.
   */
  create: protectedProcedure
    .input(CreateDataSourceRequest)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createDataSource({
          ownerId: ctx.session.user.id,
          id: input.id,
          name: input.name,
        });
      } catch (error) {
        mapDataSourceError(error);
      }
    }),

  /**
   * One Conversation's per-Message Source receipts, oldest first.
   *
   * Two consumers, one read: the transcript's "Sources included" finds its own
   * Message by id, and the sticky selection takes the last entry. Ownership of
   * the Conversation is asserted by the builder, which tolerates an absent
   * thread — the composer asks this on mount, including for a Conversation
   * whose first Turn has not been sent, and that answers as the empty list
   * rather than an error.
   */
  records: ownedConversationByIdProcedure
    .input(MessageSourcesRequest)
    .query(({ ctx, input }) =>
      listConversationSources({
        conversationId: input.conversationId,
        ownerId: ctx.session.user.id,
      }),
    ),
});
