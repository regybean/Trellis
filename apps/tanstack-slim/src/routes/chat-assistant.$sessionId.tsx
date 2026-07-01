import { createFileRoute } from '@tanstack/react-router';

import { ConversationView } from '@acme/chat';

export const Route = createFileRoute('/chat-assistant/$sessionId')({
  component: ChatSessionRoute,
});

// Deep-link route: resumes the Conversation named by the `sessionId` segment.
function ChatSessionRoute() {
  const { sessionId } = Route.useParams();
  return (
    <div className="h-[calc(100vh-4rem)]">
      <ConversationView initialSessionId={sessionId} />
    </div>
  );
}
