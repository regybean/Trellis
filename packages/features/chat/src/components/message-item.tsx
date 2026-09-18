// src/components/MessageItem.tsx
'use client';

import type React from 'react';
import { useSyncExternalStore } from 'react';
import { Bot, User } from 'lucide-react';

import { Avatar, MarkdownContent } from '@acme/ui';

import type { Message } from '../api/schemas/message-schema';
import type { RecordedSources } from '../api/schemas/message-source-schema';
import AnimatedEllipsis from '../components/animated-ellipsis';
import { MessageSources } from './message-sources';

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
  sourcesForMessage,
}: {
  message: Message;
  renderMessageActions?: (message: Message) => React.ReactNode;
  // The Message's Source receipt, threaded down rather than fetched here:
  // components in this feature hold no data layer, and one query for the
  // Conversation serves the whole transcript plus the sticky selection.
  // `undefined` means no receipt at all — a pre-feature Message, or a Turn that
  // failed — which discloses nothing.
  sourcesForMessage?: (messageId: string) => RecordedSources | undefined;
}) {
  const isUser = message.role === 'user';
  const justify = isUser ? 'justify-end' : 'justify-start';
  const direction = isUser ? 'flex-row-reverse' : 'flex-row';
  const bubbleBase = `rounded-lg p-3 ${
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
    // Only a settled ASSISTANT Message earns a footer: an optimistic user turn
    // and a streaming partial have nothing durable to act on or disclose
    // (../../docs/adr/0007-message-actions-render-slot.md). One flag decides both
    // halves of the row.
    const settledAssistantId = isUser ? undefined : message.id;

    // Bubble, then the footer row beneath it. The row is below rather than
    // inside because expanding a Source list inside a bubble would grow the
    // bubble, and because `renderMessageActions` was always specified as
    // rendering beneath the Message
    // (../../docs/adr/0007-message-actions-render-slot.md).
    messageContent = (
      <div className="mx-2 min-w-0">
        <div className={bubbleBase} data-testid={testId}>
          <MarkdownContent
            content={message.text}
            className={isUser ? 'text-white' : undefined}
          />
          <ClientMessageTime timestamp={message.timestamp} />
        </div>

        {settledAssistantId && (
          <MessageFooter
            actions={renderMessageActions?.(message)}
            recorded={sourcesForMessage?.(settledAssistantId)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      // `group` is what the hover-revealed sources trigger keys off: revealing
      // on the whole Message row rather than on the trigger itself means the
      // pointer does not have to find a control it cannot yet see.
      className={`group flex ${justify} mb-4`}
      data-testid={`message-${message.id}`}
    >
      {/* `items-start`, not `items-center`. Centred, expanding the Source list
          re-centres the column and visibly slides the avatar down the screen. */}
      <div className={`flex ${direction} max-w-[80%] items-start`}>
        <Avatar className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center">
          {isUser ? <User className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </Avatar>
        {messageContent}
      </div>
    </div>
  );
}

/**
 * The row beneath a settled assistant Message: the app's actions, then the
 * Source disclosure to their right.
 *
 * Absent entirely when there is nothing to put in it, and an empty receipt
 * counts as nothing — an empty-scope Turn is deliberately undisclosed in the
 * transcript. The alternative is a blank-but-present row adding a gap under
 * every pre-feature Message.
 */
function MessageFooter({
  actions,
  recorded,
}: {
  actions: React.ReactNode;
  recorded: RecordedSources | undefined;
}) {
  const hasSources = recorded !== undefined && recorded.length > 0;
  if (!actions && !hasSources) return null;

  return (
    // The app's actions stay always visible; the sources trigger sits to their
    // right and reveals on hover. They do not compete for space.
    <div className="mt-1 flex items-center gap-3">
      {actions}
      {recorded && <MessageSources sources={recorded} />}
    </div>
  );
}
