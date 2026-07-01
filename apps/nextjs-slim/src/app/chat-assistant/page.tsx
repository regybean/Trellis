'use client';

import { ConversationView } from '@acme/chat';

// Bare route: starts a new Conversation. Slim subset — no billing/feedback
// wiring (the app drops both).
function ChatPage() {
  return (
    <div className="bg-muted h-[calc(100vh-4rem)]">
      <ConversationView />
    </div>
  );
}
export default ChatPage;
