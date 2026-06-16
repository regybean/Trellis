// hooks/use-chat.ts
import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
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
  const [messages, setMessages] = useState<Message[]>(() => initial);
  const [queryInput, setQueryInput] = useState<string>();
  const genericErrorHandle = useGenericErrorHandler();
  const trpc = useTRPC();
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  // Helper function for updating with error
  const updateLastMessageWithError = useCallback(() => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1
          ? {
              ...m,
              error: true,
              loading: false,
              text: 'Sorry, there was an error processing your request.',
            }
          : m,
      ),
    );
  }, []);

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
            setMessages((prev) =>
              prev.map((m, i) =>
                i === prev.length - 1
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
          setMessages((prev) =>
            prev.map((m, i) =>
              i === prev.length - 1
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
            setMessages((prev) =>
              prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, loading: false } : m,
              ),
            );
            setQueryInput(undefined);
          }
        },
      },
    ),
  );

  const send = useCallback(
    (text: string) => {
      const isLoading = subscription.status === 'connecting';
      if (isLoading) return;

      // Validate message length before sending since URL becomes too long
      if (text.length > MAX_MESSAGE_LENGTH) {
        // Add user message and error response
        setMessages((prev) => {
          return [
            ...prev,
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
          ];
        });
        return;
      }

      // Optimistically render the user Message and a loading assistant
      // placeholder. The stream procedure ensures the Conversation exists and
      // persists both Messages server-side.
      setMessages((prev) => [
        ...prev,
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
    },
    [subscription.status],
  );

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
