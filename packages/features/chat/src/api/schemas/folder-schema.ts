import { pgSchema } from 'drizzle-orm/pg-core';
import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';

import { env } from '../../env';

// `chat_folder` is an app-owned, drizzle-kit-managed table — the same ownership
// seam as `message_feedback` (ADR-0002). It defines a Folder (a user-created
// grouping of Conversations); the Folder *assignment* lives on the Mastra thread
// as `metadata.folderId` (a single scalar, so a Conversation is in at most one
// Folder). There is NO foreign key from the Mastra thread metadata to this table:
// deleting a Folder leaves member threads with a dangling `folderId` that simply
// stops resolving, returning those Conversations to their Date Bucket with no
// per-Conversation write (lazy delete). See the chat CONTEXT.md.

// Same per-app Postgres schema Mastra and the knowledge base namespace under
// (NEXT_PUBLIC_WEBAPP). Declaring it here is idempotent — drizzle-kit dedupes by
// name.
export const chatSchema = pgSchema(env.NEXT_PUBLIC_WEBAPP);

export const chatFolder = chatSchema.table('chat_folder', (t) => ({
  id: t.uuid('id').primaryKey().defaultRandom(),
  userId: t.text('user_id').notNull(),
  name: t.text('name').notNull(),
  createdAt: t
    .timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}));

export const selectFolderSchema = createSelectSchema(chatFolder, {
  id: z.uuid(),
  userId: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
});
export type SelectFolder = z.infer<typeof selectFolderSchema>;

// Procedure input schemas. Folder names are trimmed and capped; duplicates are
// allowed (no uniqueness constraint) per the v1 decision. The `id` is minted by
// the client so the Folder can be created optimistically (instant in the
// sidebar) and still reconcile 1:1 with the server row — the same id is used
// for a subsequent delete, whether or not the create has settled.
export const CreateFolderRequest = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Required').max(50, 'Too long'),
});

export const DeleteFolderRequest = z.object({ id: z.uuid() });

// Assigning a Conversation to a Folder (or clearing it with `folderId: null`).
export const SetFolderRequest = z.object({
  sessionId: z.uuid(),
  folderId: z.uuid().nullable(),
});
