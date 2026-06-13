// src/components/MessageItem.tsx
'use client';

import { useEffect, useState } from 'react';
import { Bot, User } from 'lucide-react';

import { Avatar, MarkdownContent } from '@acme/ui';

import type { Message } from '../api/schemas/message-schema';
import AnimatedEllipsis from '../components/animated-ellipsis';

export default function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const justify = isUser ? 'justify-end' : 'justify-start';
  const direction = isUser ? 'flex-row-reverse' : 'flex-row';
  const bubbleBase = `mx-2 rounded-lg p-3 ${
    isUser ? 'bg-primary text-white' : 'bg-muted text-text'
  }`;
  const testId = isUser ? 'user-message' : 'bot-message';

  // Client-only timestamp to avoid SSR/CSR mismatch
  function ClientMessageTime({ timestamp }: { timestamp?: Date }) {
    const [displayTime, setDisplayTime] = useState('');
    useEffect(() => {
      if (timestamp) {
        setDisplayTime(timestamp.toLocaleTimeString());
      }
    }, [timestamp]);
    return (
      <p className="mt-1 text-right text-xs text-inherit">{displayTime}</p>
    );
  }

  let messageContent;

  if (message.error) {
    messageContent = (
      <div
        className="border-destructive text-destructive-foreground bg-destructive/10 mx-2 rounded-lg p-3"
        data-testid="message-error"
        data-error="true"
      >
        <MarkdownContent content={message.text} />
      </div>
    );
  } else if (message.loading) {
    messageContent = (
      <div
        className="flex w-full flex-col items-center"
        data-testid="ai-loading-ellipsis"
      >
        <div className="my-2">
          <AnimatedEllipsis />
        </div>
      </div>
    );
  } else {
    messageContent = (
      <div className={bubbleBase} data-testid={testId}>
        <MarkdownContent
          content={message.text}
          className={isUser ? 'text-white' : undefined}
        />
        <ClientMessageTime timestamp={message.timestamp} />
      </div>
    );
  }

  return (
    <div
      className={`flex ${justify} mb-4`}
      data-testid={`message-${message.id}`}
    >
      <div className={`flex ${direction} max-w-[80%] items-center`}>
        <Avatar className="bg-muted flex h-9 w-9 items-center justify-center">
          {isUser ? <User className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </Avatar>
        {messageContent}
      </div>
    </div>
  );
}
