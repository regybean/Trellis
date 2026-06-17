import { z } from 'zod';

// A Conversation is a Mastra Memory thread (id = sessionId, resourceId =
// userId). This schema is the client-facing view of that thread.
export const selectChatSchema = z.object({
  sessionId: z.uuid(),
  userId: z.string(),
  createdAt: z.coerce.date(),
});

export type SelectChatSchema = z.infer<typeof selectChatSchema>;

export const ChatRequest = z.object({
  query: z.string().max(10_000, 'Message too long'),
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
