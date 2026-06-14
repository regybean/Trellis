// Client-facing zod schemas — safe to import in any context. Conversations and
// messages are persisted by Mastra Memory (see @acme/rag), not a chat-owned
// table, so there are no drizzle tables to export here.
export { selectChatSchema } from './api/schemas/chat-schema';
export {
  selectMessageSchema,
  uiMessageSchema,
} from './api/schemas/message-schema';
export type { Message } from './api/schemas/message-schema';
