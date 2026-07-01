'use client';

import { ChatView } from './chat-view';

// Bare route: starts a new Conversation (the id is minted client-side and the
// URL is stamped on first interaction).
function ChatPage() {
  return <ChatView />;
}
export default ChatPage;
