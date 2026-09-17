// Client-facing zod schemas plus the two chat-owned drizzle tables.
// Conversations and messages are persisted by Mastra Memory (see @acme/rag), but
// Folders (`chat_folder`) and the per-Message Source receipt
// (`message_data_source`) are app-owned, drizzle-kit-managed tables —
// re-exported by each app's db/schema.ts so push/generate own their DDL. Both
// carry Mastra-owned ids by value with no foreign key. No `server-only` guard,
// so drizzle-kit can load it.
export { selectChatSchema } from './api/schemas/chat-schema';
export {
  selectMessageSchema,
  uiMessageSchema,
} from './api/schemas/message-schema';
export type { Message } from './api/schemas/message-schema';
export { chatFolder, selectFolderSchema } from './api/schemas/folder-schema';
export type { SelectFolder } from './api/schemas/folder-schema';
export {
  messageDataSource,
  RecordedSource,
  RecordedSources,
  selectMessageSourcesSchema,
} from './api/schemas/message-source-schema';
export type { MessageSources } from './api/schemas/message-source-schema';
