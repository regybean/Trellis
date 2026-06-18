import { createFileRoute } from '@tanstack/react-router';

import { ChatAssistant } from '@acme/chat';

export const Route = createFileRoute('/chat-assistant')({
  component: ChatRoute,
});

// Mirrors the Next.js slim chat page: just the chat slice, no auth guard and no
// billing/feedback wiring (the slim app drops both).
function ChatRoute() {
  return (
    <div className="min-h-full flex-grow p-5">
      <ChatAssistant />
    </div>
  );
}
