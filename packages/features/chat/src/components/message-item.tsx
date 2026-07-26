// src/components/MessageItem.tsx
'use client';

import type React from 'react';
import { useSyncExternalStore } from 'react';
import { Bot, User } from 'lucide-react';

import { Avatar, MarkdownContent } from '@acme/ui';

import type { Message } from '../api/schemas/message-schema';
import AnimatedEllipsis from '../components/animated-ellipsis';

// `false` during SSR and the first (hydration) client render, then `true`. Lets
// a client-only value render identically on both sides of hydration (no
// mismatch) without a setState-in-effect — useSyncExternalStore drives the
// single post-hydration re-render.
const noop = () => {
  // Nothing to subscribe to: the value flips exactly once, at hydration.
};
const subscribe = () => noop;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
const useIsHydrated = () =>
  useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

// Client-only timestamp to avoid an SSR/CSR mismatch (`toLocaleTimeString` is
// locale/timezone dependent). MUST live at module scope — NOT inside
// MessageItem's body. A component declared in render gets a fresh identity on
// every parent render, so React unmounts+remounts it each time; it would then
// re-run its hydration cycle and flip the timestamp line empty→filled on every
// streaming token. That per-token height flip on the settled (timestamped)
// messages was the fast list "jitter" during generation.
function ClientMessageTime({ timestamp }: { timestamp?: Date }) {
  const hydrated = useIsHydrated();
  const displayTime =
    hydrated && timestamp ? timestamp.toLocaleTimeString() : '';
  return <p className="mt-1 text-right text-xs text-inherit">{displayTime}</p>;
}

export default function MessageItem({
  message,
  renderMessageActions,
}: {
  message: Message;
  renderMessageActions?: (message: Message) => React.ReactNode;
}) {
  const isUser = message.role === 'user';
  const justify = isUser ? 'justify-end' : 'justify-start';
  const direction = isUser ? 'flex-row-reverse' : 'flex-row';
  const bubbleBase = `mx-2 rounded-lg p-3 ${
    isUser ? 'bg-primary text-white' : 'bg-muted text-foreground'
  }`;
  const testId = isUser ? 'user-message' : 'bot-message';

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
    // Render-slot for per-message actions (e.g. feedback). Only settled
    // assistant messages carry a persisted id, so the slot stays absent while
    // streaming and for user turns.
    const actions =
      !isUser && message.id ? renderMessageActions?.(message) : null;
    messageContent = (
      <div className={bubbleBase} data-testid={testId}>
        <MarkdownContent
          content={message.text}
          className={isUser ? 'text-white' : undefined}
        />
        <ClientMessageTime timestamp={message.timestamp} />
        {actions ? <div className="mt-2">{actions}</div> : null}
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
