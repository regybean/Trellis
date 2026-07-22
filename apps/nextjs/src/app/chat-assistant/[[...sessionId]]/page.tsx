'use client';

import { useParams } from 'next/navigation';

import { ChatView } from '../chat-view';

// Single route for both the new-Conversation landing (`/chat-assistant`) and
// deep links (`/chat-assistant/{sessionId}`). An optional catch-all keeps both
// on the SAME rendered segment, so ConversationView stamping the id is a shallow
// same-segment URL rewrite — no route remount that would tear the SSE stream,
// and no missing-segment manifest crash under Next's dev router. Absent segment
// ⇒ a fresh Conversation is minted client-side.
function ChatSessionPage() {
  const params = useParams<{ sessionId?: string[] }>();
  return <ChatView initialSessionId={params.sessionId?.[0]} />;
}
export default ChatSessionPage;
