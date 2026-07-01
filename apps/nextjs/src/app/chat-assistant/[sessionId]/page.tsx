'use client';

import { useParams } from 'next/navigation';

import { ChatView } from '../chat-view';

// Deep-link route: resumes the Conversation named by the `sessionId` segment.
function ChatSessionPage() {
  const params = useParams<{ sessionId: string }>();
  return <ChatView initialSessionId={params.sessionId} />;
}
export default ChatSessionPage;
