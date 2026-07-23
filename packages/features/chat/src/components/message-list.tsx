'use client';

import type React from 'react';
import { forwardRef, useCallback, useEffect, useRef } from 'react';

import { Skeleton } from '@acme/ui';

import type { Message } from '../api/schemas/message-schema';
import MessageItem from './message-item';

// Shown while a resumed Conversation's history is still loading (switching to a
// past chat from the sidebar), so the pane isn't blank. Alternating alignment
// mimics the user/assistant bubble rhythm.
export function MessageListSkeleton() {
  return (
    <div className="h-full space-y-6 pr-4" data-testid="message-skeleton">
      {['assistant', 'user', 'assistant'].map((role, i) => (
        <div
          key={i}
          className={
            role === 'user' ? 'flex justify-end' : 'flex justify-start'
          }
        >
          <div className="w-2/3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            {role === 'assistant' && <Skeleton className="h-4 w-3/4" />}
          </div>
        </div>
      ))}
    </div>
  );
}

interface MessageListProps {
  messages: Message[];
  shouldScrollToBottom?: boolean;
  onScrollComplete?: () => void;
  scrollToBottomRef?: React.RefObject<(() => void) | null>;
  renderMessageActions?: (message: Message) => React.ReactNode;
}

const MessageList = forwardRef<HTMLDivElement, MessageListProps>(
  ({ messages, scrollToBottomRef, renderMessageActions }, _ref) => {
    const scrollAreaRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = useCallback(() => {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
      }
    }, []);

    // Expose the scroll function to the parent via ref
    useEffect(() => {
      if (scrollToBottomRef) {
        scrollToBottomRef.current = scrollToBottom;
      }
    }, [scrollToBottom, scrollToBottomRef]);

    return (
      <div
        ref={scrollAreaRef}
        className="min-h-0 flex-1 [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden"
        data-testid="message-container"
      >
        <div className="pb-[500px]">
          {messages.map((message, index) => {
            return (
              <MessageItem
                key={message.id ?? index}
                message={message}
                renderMessageActions={renderMessageActions}
              />
            );
          })}
        </div>
      </div>
    );
  },
);

MessageList.displayName = 'MessageList';

export default MessageList;
