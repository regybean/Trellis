// hooks/use-chat.ts
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';

import { useGenericErrorHandler } from '@acme/hooks';

import type { Message } from '../api/schemas/message-schema';
import { useTRPC } from '../trpc/react';

// Keep in sync with server-side validation in chat router
const MAX_MESSAGE_LENGTH = 5000;

export function useChat(
  initial: Message[],
  sessionId: string,
  onTokensConsumed?: () => void,
) {
  // `localMessages` is null until the user interacts: the displayed list is
  // *derived* from the loaded history (or the greeting) until then, so there is
  // no effect copying server data into state. Sending seeds `localMessages` from
  // the current `base`, after which streaming mutates it directly.
  const [localMessages, setLocalMessages] = useState<Message[] | null>(null);
  const [queryInput, setQueryInput] = useState<string>();
  const genericErrorHandle = useGenericErrorHandler();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  // Resuming a Conversation: load its persisted Messages. A brand-new
  // Conversation has no thread yet, so `get` returns NOT_FOUND — not an error
  // here, just "show the greeting". `retry: false` fails fast and the rejection
  // stays silent (no global query error handler). The component is keyed by
  // sessionId, so a fresh query runs per Conversation.
  const historyQuery = useQuery(
    trpc.chat.get.queryOptions({ sessionId }, { retry: false }),
  );

  // What to show before the user has typed: the loaded history, or the greeting
  // once we know the Conversation is new/empty. Empty while still loading.
  const pickBase = (): Message[] => {
    if (historyQuery.isSuccess)
      return historyQuery.data.length > 0 ? historyQuery.data : initial;
    if (historyQuery.isError) return initial;
    return [];
  };
  const base = pickBase();

  const messages = localMessages ?? base;

  // Streaming/settle updates only ever run after `send` has seeded
  // `localMessages`, so `prev` is non-null here; `?? []` is just a type guard.
  const updateLastMessageWithError = () => {
    setLocalMessages((prev) =>
      (prev ?? []).map((m, i) =>
        i === (prev ?? []).length - 1
          ? {
              ...m,
              error: true,
              loading: false,
              text: 'Sorry, there was an error processing your request.',
            }
          : m,
      ),
    );
  };

  // tRPC subscription for streaming chat responses
  const subscription = useSubscription(
    trpc.chat.stream.subscriptionOptions(
      {
        query: queryInput ?? '',
        sessionId,
      },
      {
        enabled: !!queryInput,
        onData: (data) => {
          // The terminal `done` event carries the persisted assistant message
          // id — stamp it onto the settled message so feedback can attach
          // without refetching the Conversation.
          if (data.type === 'done') {
            setLocalMessages((prev) =>
              (prev ?? []).map((m, i) =>
                i === (prev ?? []).length - 1
                  ? {
                      ...m,
                      id: data.messageId ?? m.id,
                      sessionId: data.sessionId,
                      loading: false,
                    }
                  : m,
              ),
            );
            return;
          }
          // Update last message with accumulated text
          setLocalMessages((prev) =>
            (prev ?? []).map((m, i) =>
              i === (prev ?? []).length - 1
                ? { ...m, text: data.acc, loading: false }
                : m,
            ),
          );
        },
        onStarted: () => {
          // Scroll to bottom after starting
          setTimeout(() => scrollToBottomRef.current?.(), 0);
        },
        onError: (error) => {
          setQueryInput('');
          updateLastMessageWithError();
          genericErrorHandle(error);
        },
        onConnectionStateChange: (data) => {
          if (data.state === 'idle') {
            // Persistence is owned by the stream procedure; the client only
            // settles the optimistic UI here.
            onTokensConsumed?.();
            setLocalMessages((prev) =>
              (prev ?? []).map((m, i) =>
                i === (prev ?? []).length - 1 ? { ...m, loading: false } : m,
              ),
            );
            // Refresh the history sidebar: a new Conversation now exists (and an
            // existing one has a fresh updatedAt / generated title).
            void queryClient.invalidateQueries(trpc.chat.list.queryFilter());
            setQueryInput(undefined);
          }
        },
      },
    ),
  );

  const send = (text: string) => {
    const isLoading = subscription.status === 'connecting';
    if (isLoading) return;

    // First interaction seeds `localMessages` from the derived `base` (loaded
    // history or greeting); subsequent sends append to the live list.
    const previous = localMessages ?? base;

    // Validate message length before sending since URL becomes too long
    if (text.length > MAX_MESSAGE_LENGTH) {
      // Add user message and error response
      setLocalMessages([
        ...previous,
        {
          text,
          role: 'user' as const,
          loading: false,
          error: false,
        },
        {
          text: `Message is too long (${text.length} characters). Please keep messages under ${MAX_MESSAGE_LENGTH} characters.`,
          role: 'assistant' as const,
          loading: false,
          error: true,
        },
      ]);
      return;
    }

    // Optimistically render the user Message and a loading assistant
    // placeholder. The stream procedure ensures the Conversation exists and
    // persists both Messages server-side.
    setLocalMessages([
      ...previous,
      {
        text,
        role: 'user' as const,
        loading: false,
        error: false,
      },
      {
        text: '',
        role: 'assistant' as const,
        loading: true,
        error: false,
      },
    ]);

    // Start streaming with the query
    setQueryInput(text);
  };

  const deleteMutation = useMutation(
    trpc.chat.delete.mutationOptions({
      onError: (error) => {
        genericErrorHandle(error);
      },
    }),
  );

  const deleteChat = (sessionId: string) => {
    deleteMutation.mutate({
      sessionId,
    });
  };

  const useGetMessages = (sessionId: string) => {
    return useQuery(trpc.chat.get.queryOptions({ sessionId }));
  };

  return {
    messages,
    isLoading: subscription.status === 'connecting',
    send,
    scrollToBottomRef,
    useGetMessages,
    deleteChat,
  };
}
