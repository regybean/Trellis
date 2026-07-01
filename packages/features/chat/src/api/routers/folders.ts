import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';

import { logger } from '@acme/logger';

import {
  chatFolder,
  CreateFolderRequest,
  DeleteFolderRequest,
  selectFolderSchema,
} from '../schemas/folder-schema';
import { createTRPCRouter, protectedProcedure } from '../trpc';

// Folder CRUD. Folders are app-owned `chat_folder` rows scoped to the caller;
// the Conversation→Folder assignment lives on the Mastra thread metadata and is
// managed by `chat.setFolder`, not here. Deleting a Folder does NOT touch member
// threads — their `folderId` simply stops resolving (lazy delete), returning
// those Conversations to their Date Bucket with no per-Conversation write.
export const foldersRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { userId } = ctx.auth;
    ctx.telemetry.set({ 'user.id': userId });

    const rows = await ctx.db
      .select()
      .from(chatFolder)
      .where(eq(chatFolder.userId, userId))
      .orderBy(asc(chatFolder.createdAt));

    return rows.map((row) =>
      ctx.telemetry.parseWithTelemetry(
        selectFolderSchema,
        row,
        'selectFolderSchema',
      ),
    );
  }),

  create: protectedProcedure
    .input(CreateFolderRequest)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;
      ctx.telemetry.set({ 'user.id': userId });

      const [created] = await ctx.db
        .insert(chatFolder)
        .values({ id: input.id, userId, name: input.name })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create folder',
        });
      }

      logger.info({ userId, folderId: created.id }, 'folder created');
      return ctx.telemetry.parseWithTelemetry(
        selectFolderSchema,
        created,
        'selectFolderSchema',
      );
    }),

  delete: protectedProcedure
    .input(DeleteFolderRequest)
    .mutation(async ({ ctx, input }) => {
      const { userId } = ctx.auth;
      ctx.telemetry.set({ 'user.id': userId, 'input.folderId': input.id });

      // Scoped delete: a caller can only delete their own Folder. Member threads
      // are intentionally left untouched (lazy delete).
      await ctx.db
        .delete(chatFolder)
        .where(and(eq(chatFolder.id, input.id), eq(chatFolder.userId, userId)));

      logger.info({ userId, folderId: input.id }, 'folder deleted');
      return { id: input.id };
    }),
});
