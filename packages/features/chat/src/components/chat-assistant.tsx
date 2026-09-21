// components/chat-assistant.tsx
'use client';

import type React from 'react';
import { useState } from 'react';

import { Button, MessageInput } from '@acme/ui';

import type { Message } from '../api/schemas/message-schema';
import { getAppInfo } from '../data/app-info';
import { env } from '../env';
import { useChat } from '../hooks/use-chat';
import { useSourceSelection } from '../hooks/use-source-selection';
import { EmptyState } from './empty-state';
import MessageList, { MessageListSkeleton } from './message-list';
import { SourcePanel } from './source-panel';
import { SourcePickerButton } from './source-picker-button';

const DISCLAIMER =
  'Disclaimer: The information is for general purposes only and should not be considered professional advice. Use at your own risk. Responses may be stored for improvement purposes.';

interface ChatAssistantProps {
  // The Conversation to show. Controlled by the parent (see ConversationView):
  // resuming a past Conversation or starting a new one is a sessionId change.
  // Mounting keyed by this id loads the right history without tearing a stream.
  sessionId: string;
  onTokensConsumed?: () => void;
  // Fired on every send, so the parent can stamp the deep-link URL once the
  // Conversation becomes resumable. Expected to be idempotent — a no-op once the
  // URL already matches. See ConversationView.
  onSend?: () => void;
  // Optional render-slot seam: an app supplies per-message actions (e.g.
  // feedback buttons from `@acme/feedback`) without the chat feature depending
  // on them. Rendered only for settled assistant messages — see MessageItem.
  renderMessageActions?: (message: Message) => React.ReactNode;
  // Where the Source panel's `Upload documents` action points when the user has
  // no Data Sources at all. The app's route, because the documents page belongs
  // to `@acme/ingest` and chat may not name a sibling feature; every app in this
  // repo mounts it at `/documents`, which is the default.
  documentsPath?: string;
}

export function ChatAssistant({
  sessionId,
  onTokensConsumed,
  onSend,
  renderMessageActions,
  documentsPath = '/documents',
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
  } = useChat(sessionId, onTokensConsumed, onSend);

  // The Source Selection for the NEXT Turn, plus the per-Message receipts the
  // transcript discloses. Mounted here, at the component keyed by Conversation,
  // which is the stickiness contract `useSourceSelection` documents: switching
  // Conversation remounts and the selection re-derives from that thread's
  // latest receipt rather than carrying the last one's over.
  const selection = useSourceSelection(sessionId);

  // Whether the panel is open, and nothing else. Panel-open is not selection
  // state and deliberately does not survive a Conversation switch — the remount
  // closes it, which is the right default for a surface you open to make one
  // change.
  const [isPanelOpen, setIsPanelOpen] = useState(false);

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
        sourcesForMessage={selection.sourcesForMessage}
      />
    );
  }

  // Bounded console: a full-height flex column whose only scroller is the
  // message region. No Card/hero — the app's pageTitle/pageDescription now live
  // in the empty state, shown until the first Message lands. The Source panel is
  // a sibling column so opening it narrows the transcript rather than covering
  // it — the user picks Sources while reading the answer that prompted them to.
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {content}

        {/* Token counter and disclaimer share one subtle muted line above the
          composer — not a header chip. */}
        <p className="text-muted-foreground px-4 pb-1 text-xs">
          Uses 1 token per message · {DISCLAIMER}
        </p>

        <div className="flex w-full items-center gap-2 px-4 pb-4">
          {/* Immediately left of the input: the scope belongs beside the act of
            sending, which is the argument against a conversation-level bar. */}
          <SourcePickerButton
            selected={selection.selected}
            isEmptyScope={selection.isEmptyScope}
            isPanelOpen={isPanelOpen}
            onTogglePanel={() => setIsPanelOpen(!isPanelOpen)}
          />

          <MessageInput
            onSend={(text) => handleSend(text, selection.selectedIds)}
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

      {isPanelOpen && (
        <SourcePanel
          sources={selection.sources}
          isSelected={selection.isSelected}
          selectedCount={selection.selected.length}
          isEmptyScope={selection.isEmptyScope}
          hasNoSources={selection.hasNoSources}
          isLoading={selection.isLoadingSources}
          isTurnInFlight={isSending}
          onToggle={selection.toggle}
          onSelectAll={selection.selectAll}
          onClear={selection.clear}
          onCreate={selection.createSource}
          isCreating={selection.isCreating}
          documentsPath={documentsPath}
          onClose={() => setIsPanelOpen(false)}
        />
      )}
    </div>
  );
}
