'use client';

import type React from 'react';
import { forwardRef, useCallback, useEffect, useRef } from 'react';

import { ScrollArea } from '@acme/ui';

import type { Message } from '../api/schemas/message-schema';
import MessageItem from './message-item';

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
        const scrollContainer = scrollAreaRef.current.querySelector(
          '[data-radix-scroll-area-viewport]',
        );
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }
    }, []);

    // Expose the scroll function to the parent via ref
    useEffect(() => {
      if (scrollToBottomRef) {
        scrollToBottomRef.current = scrollToBottom;
      }
    }, [scrollToBottom, scrollToBottomRef]);

    return (
      <ScrollArea
        ref={scrollAreaRef}
        className="h-[700px] pr-4"
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
      </ScrollArea>
    );
  },
);

MessageList.displayName = 'MessageList';

export default MessageList;
