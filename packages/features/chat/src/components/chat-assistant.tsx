// components/chat-assistant.tsx
'use client';

import type React from 'react';

import { Button, MessageInput } from '@acme/ui';

import type { Message } from '../api/schemas/message-schema';
import { getAppInfo } from '../data/app-info';
import { env } from '../env';
import { useChat } from '../hooks/use-chat';
import { EmptyState } from './empty-state';
import MessageList, { MessageListSkeleton } from './message-list';

const DISCLAIMER =
  'Disclaimer: The information is for general purposes only and should not be considered professional advice. Use at your own risk. Responses may be stored for improvement purposes.';

interface ChatAssistantProps {
  // The Conversation to show. Controlled by the parent (see ConversationView):
  // resuming a past Conversation or starting a new one is a sessionId change.
  // Mounting keyed by this id loads the right history without tearing a stream.
  sessionId: string;
  onTokensConsumed?: () => void;
  // Fired the first time this mount sends a Message, so the parent can stamp the
  // deep-link URL once the Conversation becomes resumable. See ConversationView.
  onFirstSend?: () => void;
  // Optional render-slot seam: an app supplies per-message actions (e.g.
  // feedback buttons from `@acme/feedback`) without the chat feature depending
  // on them. Rendered only for settled assistant messages — see MessageItem.
  renderMessageActions?: (message: Message) => React.ReactNode;
}

export function ChatAssistant({
  sessionId,
  onTokensConsumed,
  onFirstSend,
  renderMessageActions,
}: ChatAssistantProps) {
  const info = getAppInfo(env.NEXT_PUBLIC_WEBAPP);

  const {
    messages,
    isLoading,
    isSending,
    isHistoryLoading,
    send: handleSend,
    stop,
    scrollToBottomRef,
  } = useChat(sessionId, onTokensConsumed, onFirstSend);

  // The message region: skeleton while a resumed history loads, the centered
  // empty state until the first Message lands, otherwise the scrolling list.
  let content: React.ReactNode;
  if (isHistoryLoading) {
    content = <MessageListSkeleton />;
  } else if (messages.length === 0) {
    content = (
      <EmptyState title={info.pageTitle} description={info.pageDescription} />
    );
  } else {
    content = (
      <MessageList
        messages={messages}
        scrollToBottomRef={scrollToBottomRef}
        renderMessageActions={renderMessageActions}
      />
    );
  }

  // Bounded console: a full-height flex column whose only scroller is the
  // message region. No Card/hero — the app's pageTitle/pageDescription now live
  // in the empty state, shown until the first Message lands.
  return (
    <div className="flex h-full min-h-0 flex-col">
      {content}

      {/* Token counter and disclaimer share one subtle muted line above the
          composer — not a header chip. */}
      <p className="text-muted-foreground px-4 pb-1 text-xs">
        Uses 1 token per message · {DISCLAIMER}
      </p>

      <div className="flex w-full items-center gap-2 px-4 pb-4">
        <MessageInput
          onSend={handleSend}
          isLoading={isLoading}
          placeholder="Type your message..."
          inputTestId="chat-input"
          buttonTestId="chat-send-button"
          spinnerTestId="chat-spinner"
        />
        {/* Stop is available only while a Turn is in-flight — it cancels
            generation (chat.stop) without blocking the still-editable input, so
            the user can draft their next message. */}
        {isSending && (
          <Button
            type="button"
            variant="outline"
            onClick={stop}
            aria-label="Stop generating"
            data-testid="chat-stop-button"
          >
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
