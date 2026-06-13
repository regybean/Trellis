// components/chat-assistant.tsx
'use client';

import { useMemo } from 'react';

import { Card, CardContent, CardFooter, MessageInput } from '@acme/ui';

import { getAppInfo } from '../data/app-info';
import { env } from '../env';
import { useChat } from '../hooks/use-chat';
import ChatFooter from './chat-footer';
import MessageList from './message-list';

interface ChatAssistantProps {
  onTokensConsumed?: () => void;
}

export function ChatAssistant({ onTokensConsumed }: ChatAssistantProps) {
  const info = getAppInfo(env.NEXT_PUBLIC_WEBAPP);
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  const {
    messages,
    isLoading,
    send: handleSend,
    scrollToBottomRef,
  } = useChat(
    [
      {
        text: info.initialMessage,
        role: 'assistant',
      },
    ],
    sessionId,
    onTokensConsumed,
  );

  return (
    <div className="container mx-auto py-4">
      <div className="mx-auto mb-12 max-w-4xl text-center">
        <h1 className="text-foreground text-4xl font-extrabold sm:text-5xl">
          {info.pageTitle}
        </h1>
        <p className="text-muted-foreground mt-4 mb-4 text-xl">
          {info.pageDescription}
        </p>
      </div>

      <Card className="border-border mx-auto w-full max-w-7xl overflow-hidden pt-0 shadow-sm">
        <div className="bg-primary h-2"></div>
        <CardContent>
          <MessageList
            messages={messages}
            scrollToBottomRef={scrollToBottomRef}
          />
          <hr className="border-borderborder-t" />
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <div className="flex w-full items-center gap-2">
            <div className="ml-auto text-right">
              <span className="text-muted-foreground text-xs">
                Uses 1 token per message
              </span>
            </div>
          </div>
          <MessageInput
            onSend={handleSend}
            isLoading={isLoading}
            placeholder="Type your message..."
            inputTestId="chat-input"
            buttonTestId="chat-send-button"
            spinnerTestId="chat-spinner"
          />
        </CardFooter>
      </Card>
      <ChatFooter />
    </div>
  );
}
