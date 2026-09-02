export const name = 'chat';

export { ChatAssistant } from './components/chat-assistant';
export { ConversationView } from './components/conversation-view';
export {
  clearChatPersistedCache,
  TRPCProvider as ChatTRPCProvider,
} from './trpc/react';
export type { Message as ChatMessage } from './api/schemas/message-schema';
