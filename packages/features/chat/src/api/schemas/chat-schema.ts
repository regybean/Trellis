import { z } from 'zod';

// A Conversation is a Mastra Memory thread (id = sessionId, resourceId =
// userId). This schema is the client-facing view of that thread.
export const selectChatSchema = z.object({
  sessionId: z.uuid(),
  userId: z.string(),
  createdAt: z.coerce.date(),
});

export type SelectChatSchema = z.infer<typeof selectChatSchema>;

// A row in the Conversation History list: enough to render the sidebar without
// loading any Messages. `folderId` is the Folder assignment read from the
// thread's `metadata.folderId` (null when un-foldered). Date Buckets are derived
// client-side from `updatedAt`, so the server only sorts — it sends no bucket.
export const selectConversationSummarySchema = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  updatedAt: z.coerce.date(),
  folderId: z.uuid().nullable(),
});

export type SelectConversationSummary = z.infer<
  typeof selectConversationSummarySchema
>;

// The single source of truth for the maximum Message length. The server schema
// (`ChatRequest`) and the client-side pre-send guard (`useChat`) both read this
// one constant, so they cannot drift.
export const MAX_MESSAGE_LENGTH = 10_000;

export const ChatRequest = z.object({
  query: z.string().max(MAX_MESSAGE_LENGTH, 'Message too long'),
  sessionId: z.uuid(),
});

export const DeleteChatRequest = z.object({
  sessionId: z.uuid(),
});

export type StreamChatEvent =
  | {
      type: 'message';
      acc: string;
      chunk: string;
      ts: string;
      sessionId: string;
    }
  | {
      type: 'done';
      ts: string;
      sessionId: string;
      // The id Mastra minted for the persisted assistant turn, or null when it
      // could not be resolved. Lets the client attach feedback to the settled
      // message without refetching the Conversation.
      messageId: string | null;
    };
