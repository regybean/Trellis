'use client';

import type React from 'react';
import { useState } from 'react';

import type { Message } from '../api/schemas/message-schema';
import { ChatAssistant } from './chat-assistant';
import { ConversationSidebar } from './conversation-sidebar';

interface ConversationViewProps {
  // The Conversation to open on load, from the route's `sessionId` segment.
  // Absent on the bare `/chat-assistant` route, where a fresh one is minted.
  initialSessionId?: string;
  // Path the deep-link URL is built from; the app owns its route, the feature
  // only stamps the id onto it.
  basePath?: string;
  onTokensConsumed?: () => void;
  renderMessageActions?: (message: Message) => React.ReactNode;
}

// The Conversation History surface: the sidebar plus the active Conversation.
// It owns the current sessionId and keeps the URL in sync via the History API
// (not the framework router), so switching Conversations — or stamping a freshly
// minted id onto the bare route — never triggers a route remount that would tear
// the SSE stream. ChatAssistant is keyed by sessionId, so resuming a past
// Conversation deliberately remounts to load its history, while typing the first
// message of a new Conversation (id already minted) does not.
export function ConversationView({
  initialSessionId,
  basePath = '/chat-assistant',
  onTokensConsumed,
  renderMessageActions,
}: ConversationViewProps) {
  const [sessionId, setSessionId] = useState(
    () => initialSessionId ?? crypto.randomUUID(),
  );

  // Switching Conversations (sidebar select or new chat) sets state and stamps
  // the deep-link URL in one step — no navigation, no remount of this view. The
  // freshly minted Conversation on the bare route simply has no id in the URL
  // until the first such interaction, which needs no effect.
  const select = (id: string) => {
    setSessionId(id);
    globalThis.history.replaceState(null, '', `${basePath}/${id}`);
  };

  return (
    <div className="flex h-full min-h-0">
      <ConversationSidebar
        currentSessionId={sessionId}
        onSelect={select}
        onNewConversation={() => select(crypto.randomUUID())}
      />
      <div className="min-w-0 flex-1 overflow-auto">
        <ChatAssistant
          key={sessionId}
          sessionId={sessionId}
          onTokensConsumed={onTokensConsumed}
          renderMessageActions={renderMessageActions}
        />
      </div>
    </div>
  );
}
