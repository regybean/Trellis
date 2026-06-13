// Exports for database schema - can be imported in any context (CLI, server, client build)
// Does NOT include server-only guard to allow drizzle-kit to load schemas
export { chats } from './api/schemas/chat-schema';
export { messages } from './api/schemas/message-schema';
