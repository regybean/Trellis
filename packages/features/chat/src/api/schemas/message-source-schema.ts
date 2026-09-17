import { index } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { chatSchema } from './folder-schema';

/**
 * A **recorded Source**: one Data Source as it stood when a Turn settled, by id
 * AND by name.
 *
 * The name is stored, not resolved on read, and that is the whole point of the
 * shape. This is a receipt about a settled Turn, and the entity it points at is
 * destroyable by rag's cascade — so a Source named on an old Message is absent
 * from a fresh list forever, not merely from a stale cache. With ids alone the
 * transcript would permanently reference labels nothing can resolve.
 *
 * It is also cheap only now. Once rows exist carrying ids alone the names are
 * gone and no backfill can invent them.
 *
 * The consequence, accepted: a later rename leaves history showing the old
 * name. That is correct receipt semantics — it says what was included, under
 * the name it had.
 */
export const RecordedSource = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const RecordedSources = z.array(RecordedSource);
export type RecordedSources = z.infer<typeof RecordedSources>;

/**
 * `message_data_source` — the per-Message receipt, an app-owned,
 * drizzle-kit-managed table like `chat_folder`, re-exported by each app's
 * `db/schema.ts` so push/generate own its DDL.
 *
 * **Keyed on the assistant Message**, where the disclosure renders and the Turn
 * where retrieval could actually have happened. Mastra mints that id during
 * streaming, so the Generation worker writes this row from the already-validated
 * set in its job payload — not from stored state it went and trusted. Keying on
 * the user Message would let `chat.send` write synchronously, but then the
 * disclosure would have to hop from an assistant Message to its preceding user
 * Message to find its own data.
 *
 * `message_id` is the PRIMARY KEY, departing from `message_feedback`'s surrogate
 * id plus unique constraint. That table needs a surrogate because its natural
 * key is composite and it upserts; here the natural key is a single column
 * written once, so a surrogate would buy a second index and the ability to
 * insert two contradictory Source sets for one Message.
 *
 * No foreign key to `mastra_messages`, following the same seam as `chat_folder`:
 * Mastra owns those rows' DDL and lifecycle (see `@acme/rag` ADR 0001), so
 * Mastra-owned ids are carried by value.
 *
 * `sources` is a jsonb collection and **the empty collection is a first-class
 * value** — that is what makes "zero Sources, deliberately" distinguishable
 * from "pre-feature Message, no record at all". One row per Source would render
 * both as zero rows, and the sticky empty set depends on telling them apart.
 *
 * A **failed Turn writes no row**, so the sticky set reads through to the
 * previous settled Turn rather than resetting. A failed Turn is invisible to
 * stickiness.
 */
export const messageDataSource = chatSchema.table(
  'message_data_source',
  (t) => ({
    messageId: t.text('message_id').primaryKey(),
    threadId: t.text('thread_id').notNull(),
    ownerId: t.text('owner_id').notNull(),
    sources: t.jsonb('sources').$type<RecordedSources>().notNull(),
    createdAt: t
      .timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    // `thread_id` and `created_at` earn their place as the sticky-set query —
    // the latest row for a thread and owner. Unlike `chat_folder`, this table
    // grows once per Turn rather than once per user action, so the read behind
    // every composer mount gets an index rather than a scan over every
    // Conversation's receipts.
    index('message_data_source_thread_created_idx').on(t.threadId, t.createdAt),
  ],
);

/**
 * One Message's receipt as the client reads it. `ownerId` and `threadId` are
 * deliberately absent: both are already known to a caller that got this far
 * (the procedure is owner- and Conversation-scoped), and re-sending the owner
 * id to the owner is noise.
 */
export const selectMessageSourcesSchema = z.object({
  messageId: z.string(),
  sources: RecordedSources,
});

export type MessageSources = z.infer<typeof selectMessageSourcesSchema>;

/** The per-Message receipts for one Conversation, read by `conversationId`. */
export const MessageSourcesRequest = z.object({ conversationId: z.uuid() });
