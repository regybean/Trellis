'use client';

import { useParams } from 'next/navigation';

import { ConversationView } from '@acme/chat';

// Single optional-catch-all route for both the new-Conversation landing and
// deep links (see the nextjs app for the rationale): keeps both on one rendered
// segment so id-stamping on first send is a shallow same-segment rewrite. Slim
// subset — no billing/feedback wiring (the app drops both).
function ChatSessionPage() {
  const params = useParams<{ sessionId?: string[] }>();
  return (
    <div className="bg-muted h-full">
      <ConversationView initialSessionId={params.sessionId?.[0]} />
    </div>
  );
}
export default ChatSessionPage;
