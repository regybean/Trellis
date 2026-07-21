// hooks/use-chat.ts
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { toast } from 'react-toastify';

import { useGenericErrorHandler } from '@acme/hooks';

import type { SelectConversationSummary } from '../api/schemas/chat-schema';
import type { Message } from '../api/schemas/message-schema';
import { MAX_MESSAGE_LENGTH } from '../api/schemas/chat-schema';
import { useTRPC } from '../trpc/react';

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
  // The in-flight query text. Non-null ⇒ a Turn is in-flight from this client
  // and the pure-reader subscription is open; drives both `enabled` and the
  // send-gate. Cleared to `undefined` when the Turn settles.
  const [queryInput, setQueryInput] = useState<string>();
  const genericErrorHandle = useGenericErrorHandler();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  // Turn bookkeeping read only inside the subscription/mutation callbacks (never
  // rendered), so refs avoid stale-closure reads without extra renders:
  // - `streamingRef`       — a Turn is live; guards `settleStream` against a
  //   spurious `idle` (e.g. before the reader ever opened).
  // - `terminalReceivedRef` — the reader delivered a done/cancelled/error
  //   terminal; a close *without* one is an orphan.
  // - `inflightTurnIdRef`  — the `turnId` THIS client minted and got `accepted`
  //   for. Null when we merely attached to another tab's Turn
  //   (`alreadyInflight`), so only the owning client reconciles/refunds.
  const streamingRef = useRef(false);
  const terminalReceivedRef = useRef(false);
  const inflightTurnIdRef = useRef<string | null>(null);

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

  // Skeleton the message pane only while a resumed Conversation's history is
  // loading and the user hasn't started interacting. For a brand-new session
  // `get` resolves near-instantly (empty / NOT_FOUND) so the greeting follows.
  const isHistoryLoading = historyQuery.isLoading && localMessages === null;

  // The Conversation History sidebar reads `chat.list`. On the first send of a
  // new Conversation we prepend a placeholder titled "New chat" so it appears
  // immediately; a resend bumps the existing row to the top with a fresh
  // updatedAt. The real (LLM-generated) title arrives when the list is
  // invalidated on stream settle. Client-optimistic, server reconciles lazily.
  const listKey = trpc.chat.list.queryKey();
  const upsertConversationInList = () => {
    queryClient.setQueryData<SelectConversationSummary[]>(listKey, (old) => {
      const now = new Date();
      const existing = old ?? [];
      const current = existing.find((c) => c.sessionId === sessionId);
      const rest = existing.filter((c) => c.sessionId !== sessionId);
      const next: SelectConversationSummary = current
        ? { ...current, updatedAt: now }
        : { sessionId, title: 'New chat', updatedAt: now, folderId: null };
      return [next, ...rest];
    });
  };

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

  // Mark the last (assistant) message settled — either stamped with the
  // persisted `messageId` from a terminal (so feedback can attach without a
  // refetch) or just cleared of its loading flag.
  const settleLastMessage = (messageId: string | null) => {
    setLocalMessages((prev) =>
      (prev ?? []).map((m, i) =>
        i === (prev ?? []).length - 1
          ? { ...m, id: messageId ?? m.id, sessionId, loading: false }
          : m,
      ),
    );
  };

  // Idempotent orphan cleanup + refund. Called when the reader closed without a
  // terminal and THIS client owns the Turn; the toast tells the user why the
  // response vanished and that they were not charged for it.
  const reconcileMutation = useMutation(
    trpc.chat.reconcileTurn.mutationOptions({
      onSuccess: () => {
        toast.error('Generation failed — your credits have been refunded.', {
          autoClose: 6000,
          closeButton: true,
        });
      },
      onError: (error) => genericErrorHandle(error),
    }),
  );

  // The single settle path for every way a Turn ends: a terminal followed by a
  // clean reader close (idle), a stop, or the reader closing with no terminal at
  // all (orphan). Idempotent via `streamingRef` so the `idle` that trails a
  // terminal, or a redundant error, is a no-op.
  const settleStream = () => {
    if (!streamingRef.current) return;
    streamingRef.current = false;

    // The Conversation now exists server-side (and, on a first Turn, has an
    // LLM-generated title); refresh the sidebar so "New chat" reconciles.
    onTokensConsumed?.();
    void queryClient.invalidateQueries(trpc.chat.list.queryFilter());

    const turnId = inflightTurnIdRef.current;
    inflightTurnIdRef.current = null;

    if (terminalReceivedRef.current) {
      settleLastMessage(null);
    } else {
      // Reader closed without a terminal: the worker died mid-Turn. Surface the
      // failure on the pending assistant message; reconcile + refund only the
      // Turn we own (an attached-only client has no turnId and nothing to
      // refund — the owning tab reconciles).
      updateLastMessageWithError();
      if (turnId)
        reconcileMutation.mutate({ conversationId: sessionId, turnId });
    }

    setQueryInput(undefined);
  };

  // tRPC subscription: a pure reader of the durable token Stream (T5). The
  // Generation worker produces tokens out-of-band; this only tails and renders
  // them. It is opened by `send`/`stop` setting `queryInput`; the control plane
  // (send / stop / reconcileTurn) lives in the mutations below.
  useSubscription(
    trpc.chat.stream.subscriptionOptions(
      { conversationId: sessionId },
      {
        enabled: queryInput !== undefined,
        onData: ({ data: event }) => {
          if (event.type === 'done' || event.type === 'cancelled') {
            terminalReceivedRef.current = true;
            settleLastMessage(event.messageId);
            return;
          }
          if (event.type === 'error') {
            terminalReceivedRef.current = true;
            updateLastMessageWithError();
            return;
          }
          // `delta`: append the token to the last (assistant) message.
          setLocalMessages((prev) =>
            (prev ?? []).map((m, i) =>
              i === (prev ?? []).length - 1
                ? { ...m, text: m.text + event.chunk, loading: false }
                : m,
            ),
          );
        },
        onStarted: () => {
          // Scroll to bottom after starting
          setTimeout(() => scrollToBottomRef.current?.(), 0);
        },
        // The reader failed unrecoverably (tRPC transparently retries recoverable
        // drops, so this is terminal). Treat as a stream close: `settleStream`
        // reconciles the owned Turn if no terminal ever arrived.
        onError: () => settleStream(),
        // A clean server-side close drains to `idle`; settle here so a normal
        // completion and an orphaned close share one path.
        onConnectionStateChange: (data) => {
          if (data.state === 'idle') settleStream();
        },
      },
    ),
  );

  // Initiate a Turn (T4 `chat.send`). Mints the `turnId`, opens the reader, and
  // fires the mutation. `accepted` ⇒ we own the Turn; `alreadyInflight` ⇒
  // another tab is already generating, so we stay a pure reader (disarm
  // reconcile) rather than re-sending. A send failure closes the reader.
  const sendMutation = useMutation(
    trpc.chat.send.mutationOptions({
      onSuccess: (result) => {
        if (result.status === 'alreadyInflight')
          inflightTurnIdRef.current = null;
      },
      onError: (error) => {
        streamingRef.current = false;
        inflightTurnIdRef.current = null;
        setQueryInput(undefined);
        updateLastMessageWithError();
        genericErrorHandle(error);
      },
    }),
  );

  // A Turn is in-flight from send() until settle: the send button is gated the
  // whole time (mutation pending, then the reader is open) while the input stays
  // editable so the user can draft their next message.
  const isSending = sendMutation.isPending || queryInput !== undefined;

  const send = (text: string) => {
    if (isSending) return;

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
    // placeholder. `chat.send` persists the user Message server-side; the worker
    // fills the assistant one via the Stream.
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

    // Surface the Conversation in the history sidebar right away.
    upsertConversationInList();

    // Arm the Turn and open the reader, then initiate generation.
    const turnId = crypto.randomUUID();
    terminalReceivedRef.current = false;
    inflightTurnIdRef.current = turnId;
    streamingRef.current = true;
    setQueryInput(text);
    sendMutation.mutate({ query: text, conversationId: sessionId, turnId });
  };

  // Cancel the in-flight Turn (T4 `chat.stop`). The worker also emits a
  // `cancelled` terminal via the Stream, but we settle the UI now and mark the
  // Turn terminal so the closing reader is not mistaken for an orphan.
  const stopMutation = useMutation(
    trpc.chat.stop.mutationOptions({
      onSuccess: () => {
        terminalReceivedRef.current = true;
        settleStream();
      },
      onError: (error) => genericErrorHandle(error),
    }),
  );

  const stop = () => {
    if (!streamingRef.current) return;
    stopMutation.mutate({ conversationId: sessionId });
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
    isLoading: isSending,
    isSending,
    isHistoryLoading,
    send,
    stop,
    scrollToBottomRef,
    useGetMessages,
    deleteChat,
  };
}
