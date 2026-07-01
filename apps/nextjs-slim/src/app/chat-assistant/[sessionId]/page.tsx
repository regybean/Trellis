'use client';

import { useParams } from 'next/navigation';

import { ConversationView } from '@acme/chat';

// Deep-link route: resumes the Conversation named by the `sessionId` segment.
function ChatSessionPage() {
  const params = useParams<{ sessionId: string }>();
  return (
    <div className="bg-muted h-[calc(100vh-4rem)]">
      <ConversationView initialSessionId={params.sessionId} />
    </div>
  );
}
export default ChatSessionPage;
