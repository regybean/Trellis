// Client-facing zod schemas plus the one chat-owned drizzle table. Conversations
// and messages are persisted by Mastra Memory (see @acme/rag), but Folders are an
// app-owned, drizzle-kit-managed table (`chat_folder`) — re-exported by each app's
// db/schema.ts so push/generate own its DDL. No `server-only` guard, so
// drizzle-kit can load it.
export { selectChatSchema } from './api/schemas/chat-schema';
export {
  selectMessageSchema,
  uiMessageSchema,
} from './api/schemas/message-schema';
export type { Message } from './api/schemas/message-schema';
export { chatFolder, selectFolderSchema } from './api/schemas/folder-schema';
export type { SelectFolder } from './api/schemas/folder-schema';
