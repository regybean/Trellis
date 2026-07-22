'use client';

import type React from 'react';
import { useState } from 'react';

import type { Message } from '../api/schemas/message-schema';
import { ChatAssistant } from './chat-assistant';
import { ConversationSidebar } from './conversation-sidebar';

// Reconcile the address bar to `target` via `replaceState` — not `pushState` (no
// back-stack entry / popstate to keep in sync) and never the framework router (a
// router navigation refetches and remounts the segment, tearing the live SSE
// stream and invalidating Next's App Router cache). Pass through the *existing*
// `history.state` rather than `null` so Next's patched `replaceState` keeps its
// per-entry router bookkeeping instead of corrupting the cache. Idempotent: a
// no-op when the URL already matches (deep link on mount, a resend after the id
// is already stamped).
function syncUrl(target: string) {
  if (globalThis.location.pathname !== target) {
    globalThis.history.replaceState(globalThis.history.state, '', target);
  }
}

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
// It owns the current sessionId and keeps the deep-link URL in sync via the
// History API (never the framework router — a router navigation would refetch
// and remount the segment, tearing the live SSE stream and invalidating Next's
// App Router cache). The id is cosmetic until the first Message is sent (no DB
// row / thread / sidebar entry exists before then), so the URL only carries it
// once the Conversation is actually resumable: bare on a new chat, stamped on
// first send, and stamped immediately when resuming a real Conversation (sidebar
// select or deep link). Reconciliation is imperative at those moments — no mount
// effect. ChatAssistant is keyed by sessionId, so resuming a past Conversation
// deliberately remounts to load its history, while typing the first message of a
// new Conversation (id already minted) does not.
export function ConversationView({
  initialSessionId,
  basePath = '/chat-assistant',
  onTokensConsumed,
  renderMessageActions,
}: ConversationViewProps) {
  const [sessionId, setSessionId] = useState(
    () => initialSessionId ?? crypto.randomUUID(),
  );

  // Selecting an existing Conversation (sidebar) resumes a real, resumable
  // Conversation — stamp its id immediately.
  const select = (id: string) => {
    setSessionId(id);
    syncUrl(`${basePath}/${id}`);
  };

  // "New chat": mint a fresh id but keep the URL bare — the id stays cosmetic
  // until the first send makes the Conversation resumable.
  const newConversation = () => {
    setSessionId(crypto.randomUUID());
    syncUrl(basePath);
  };

  return (
    <div className="flex h-full min-h-0">
      <ConversationSidebar
        currentSessionId={sessionId}
        onSelect={select}
        onNewConversation={newConversation}
      />
      <div className="min-w-0 flex-1 overflow-auto">
        <ChatAssistant
          key={sessionId}
          sessionId={sessionId}
          onTokensConsumed={onTokensConsumed}
          // First send stamps the id so the Conversation survives a refresh
          // mid-generation (durable stream + worker resume). Threaded up from
          // useChat.send; idempotent, so a resend or an already-stamped resume
          // is a no-op.
          onFirstSend={() => syncUrl(`${basePath}/${sessionId}`)}
          renderMessageActions={renderMessageActions}
        />
      </div>
    </div>
  );
}
