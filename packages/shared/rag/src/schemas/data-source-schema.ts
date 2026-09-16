import { sql } from 'drizzle-orm';
import { uniqueIndex } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { ragSchema } from './documents-schema';

// A Data Source is a user-owned, private, named partition of the knowledge
// base. Every chunk belongs to exactly one, and the chunk's `data_source_id`
// metadata carries the membership — so this table holds the Source's identity
// and name, never its contents.
//
// `data_source` is app-owned and drizzle-kit-managed, unlike its sibling in
// `documents-schema.ts`: `mastra_documents` lives in the dedicated vector
// database with Mastra owning the DDL. Both namespace under the same per-app
// Postgres schema name (`NEXT_PUBLIC_WEBAPP`), in two different databases,
// which is why `ragSchema` is reused here rather than redeclared.
//
// `owner_id`, not `user_id`, departing from `chat_folder.user_id`. The chunk
// metadata key is `owner_id` and "owned" is the vocabulary the whole privacy
// boundary is written in; two names for one concept across the two places a
// reviewer checks that boundary is how a review misses something.
//
// The id is minted by the client so a Source can be created optimistically
// (inline in the upload dialog) and still reconcile 1:1 with the server row.
// That is safe ONLY because the retrieval filter's first clause is
// `owner_id = <verified userId>`: drop it as a redundant optimisation and
// id-minting becomes an adoption attack on a deleted Source's orphaned chunks.
//
// No `description`, `colour` or `icon`: a Source list needing colour-coding to
// be legible means the cap is too high. No denormalised `document_count`
// either — it is derived from the vector mirror and it is what the
// cascade-delete confirmation shows, so it must be true rather than
// approximately true. `updated_at` is here because rename is; identity is the
// id and no chunk carries the name, so a rename touches zero vector rows.
export const dataSource = ragSchema.table(
  'data_source',
  (t) => ({
    id: t.uuid('id').primaryKey(),
    ownerId: t.text('owner_id').notNull(),
    name: t.text('name').notNull(),
    createdAt: t
      .timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: t
      .timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    // Names are unique per owner, case-insensitively — a departure from
    // `chat_folder`, which explicitly allows duplicates, and the departure is
    // the point. A Folder name is decoration on a list you are browsing, so two
    // "Work" folders are untidy. A Data Source name is the only thing the user
    // reads when deciding what the model may see, so two identically-named
    // entries in a multi-select picker is an ambiguity in the privacy boundary
    // itself. The stored name keeps the case the user typed; only the index is
    // case-folded. Hard delete frees the name for reuse.
    //
    // This constraint is the RACE backstop, not the first line of defence: the
    // client validates against its cached list so a collision surfaces as a
    // form error before any optimistic row or presign call.
    uniqueIndex('data_source_owner_name_unique').on(
      t.ownerId,
      sql`lower(${t.name})`,
    ),
  ],
);

export const selectDataSourceSchema = createSelectSchema(dataSource, {
  id: z.uuid(),
  ownerId: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SelectDataSource = z.infer<typeof selectDataSourceSchema>;

// The name rule, in one place. Trimming is part of the rule rather than a
// router's courtesy: the unique index case-folds but does not trim, so two
// Sources named "Work" and " Work" would both be storable if any caller skipped
// this. The server module parses through it for exactly that reason.
export const DataSourceName = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(50, 'Too long');

// Procedure input schemas. The `id` is client-minted (see the table comment).
export const CreateDataSourceRequest = z.object({
  id: z.uuid(),
  name: DataSourceName,
});

export const RenameDataSourceRequest = z.object({
  id: z.uuid(),
  name: DataSourceName,
});

export const DeleteDataSourceRequest = z.object({ id: z.uuid() });
