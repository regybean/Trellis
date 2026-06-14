import { z } from 'zod';

// Client-facing Message contract. Messages are now persisted by Mastra Memory
// (mastra_messages); these schemas describe how a single turn is exposed to the
// UI, decoupled from the storage layout.
export const selectMessageSchema = z.object({
  id: z.string(),
  sessionId: z.uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  timestamp: z.coerce.date(),
});

export type SelectMessageSchema = z.infer<typeof selectMessageSchema>;

export const uiMessageSchema = selectMessageSchema
  .extend({
    loading: z.boolean().optional(),
    error: z.boolean().optional(),
  })
  .partial({
    id: true,
    sessionId: true,
    timestamp: true,
  });

export type Message = z.infer<typeof uiMessageSchema>;
