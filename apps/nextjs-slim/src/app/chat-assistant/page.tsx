'use client';

import { ChatAssistant } from '@acme/chat';

function ChatPage() {
  return (
    <div className="bg-muted min-h-screen flex-grow p-5">
      <ChatAssistant />
    </div>
  );
}
export default ChatPage;
