import { createFileRoute } from '@tanstack/react-router';

import { ConversationView } from '@acme/chat';

export const Route = createFileRoute('/chat-assistant')({
  component: ChatRoute,
});

// Bare route: starts a new Conversation. Slim subset — no auth guard, no
// billing/feedback wiring (the slim app drops both).
function ChatRoute() {
  return (
    <div className="h-[calc(100vh-4rem)]">
      <ConversationView />
    </div>
  );
}
