// hooks/use-chat.ts
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { toast } from 'react-toastify';

import { persistMeta, useGenericErrorHandler } from '@acme/hooks';

import type { SelectConversationSummary } from '../api/schemas/chat-schema';
import type { Message } from '../api/schemas/message-schema';
import { MAX_MESSAGE_LENGTH } from '../api/schemas/chat-schema';
import { useTRPC } from '../trpc/react';

export function useChat(
  sessionId: string,
  onTokensConsumed?: () => void,
  onFirstSend?: () => void,
) {
  // `localMessages` is null until the user interacts: the displayed list is
  // *derived* from the loaded history until then, so there is no effect copying
  // server data into state. Sending seeds `localMessages` from the current
  // `base`, after which streaming mutates it directly.
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
  // True once this mount has taken over a Turn's lifecycle — via `send`
  // (openReader) or a resume-adopt. Stops a stale `inflightTurn` cache from
  // re-triggering a phantom resume after the Turn has settled in this mount.
  const resumeConsumedRef = useRef(false);

  // The single reactive "a Turn is in-flight from this client's POV" flag (spec
  // #39): drives the send-gate and the Stop button. Set on send and on
  // resume-adopt, cleared on settle. `streamingRef` remains the *synchronous*
  // guard read inside async callbacks (where state would be stale); this is its
  // render-visible mirror.
  const [turnActive, setTurnActive] = useState(false);

  // Resuming a Conversation: load its persisted Messages. A brand-new
  // Conversation has no thread yet, so `get` returns NOT_FOUND — not an error
  // here, just "show an empty pane". `retry: false` fails fast and the rejection
  // stays silent (no global query error handler). The component is keyed by
  // sessionId, so a fresh query runs per Conversation.
  const historyQuery = useQuery(
    trpc.chat.get.queryOptions(
      { sessionId },
      { retry: false, meta: persistMeta },
    ),
  );

  // Resume-after-refresh: on mount ask whether a Turn is already generating for
  // this Conversation (the In-flight lock's turnId). If so we reopen the pure
  // reader and adopt the Turn even though THIS client never sent it — the token
  // Stream is durable, so we tail it from the head and keep rendering. Keyed by
  // sessionId (the component remounts per Conversation), so it refetches on
  // switch and never leaks a stale in-flight signal across Conversations.
  const inflightQuery = useQuery(
    trpc.chat.inflightTurn.queryOptions({ conversationId: sessionId }),
  );
  const resumedTurnId = inflightQuery.data?.turnId ?? null;

  // What to show before the user has typed: the loaded history, or an empty
  // pane once we know the Conversation is new/empty. Empty while still loading.
  const pickBase = (): Message[] => {
    if (historyQuery.isSuccess)
      return historyQuery.data.length > 0 ? historyQuery.data : [];
    if (historyQuery.isError) return [];
    return [];
  };
  const base = pickBase();

  const messages = localMessages ?? base;

  // Skeleton the message pane only while a resumed Conversation's history is
  // loading and the user hasn't started interacting. For a brand-new session
  // `get` resolves near-instantly (empty / NOT_FOUND) so the empty pane follows.
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

  // The messages to show while resuming a Turn: the persisted history
  // (authoritative — it already includes the user Message saved at send) plus a
  // loading assistant bubble the Stream fills. Read from the query cache so it's
  // the freshest history rather than a value captured when the subscription
  // options were built.
  const resumeSeed = (): Message[] => {
    const history =
      queryClient.getQueryData<Message[]>(
        trpc.chat.get.queryKey({ sessionId }),
      ) ?? [];
    const persisted = history.length > 0 ? history : [];
    return [
      ...persisted,
      { text: '', role: 'assistant' as const, loading: true, error: false },
    ];
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

  // Reader closed with no terminal. Either the Turn genuinely orphaned (the
  // worker died mid-Turn) or it *completed* but this reader — typically a
  // resumed one — attached too late and the Stream had already TTL'd away before
  // it could read the terminal. `chat.get` is authoritative: if the assistant
  // Message for the pending user Turn is now persisted, adopt server truth
  // (drop the local optimistic list); only if it is still missing did the Turn
  // really fail — surface the error and reconcile + refund the Turn we own (an
  // attached-only client has no turnId and nothing to refund).
  const reconcileOrAdopt = async (turnId: string | null) => {
    try {
      const persisted = await queryClient.fetchQuery(
        trpc.chat.get.queryOptions(
          { sessionId },
          { retry: false, meta: persistMeta },
        ),
      );
      const users = persisted.filter((m) => m.role === 'user').length;
      const assistants = persisted.filter((m) => m.role === 'assistant').length;
      // Every user Turn resolves into one assistant Message; equal counts ⇒ the
      // pending Turn produced its answer, so this was a missed terminal, not an
      // orphan.
      if (assistants >= users && users > 0) {
        setLocalMessages(null);
        return;
      }
    } catch {
      // Fall through to the orphan path if history can't be read.
    }
    updateLastMessageWithError();
    if (turnId) reconcileMutation.mutate({ conversationId: sessionId, turnId });
  };

  // The single settle path for every way a Turn ends: a terminal followed by a
  // clean reader close (idle), a stop, or the reader closing with no terminal at
  // all (orphan / missed terminal). Idempotent via `streamingRef` so the `idle`
  // that trails a terminal, or a redundant error, is a no-op.
  const settleStream = () => {
    if (!streamingRef.current) return;
    streamingRef.current = false;
    setTurnActive(false);

    // The Conversation now exists server-side (and, on a first Turn, has an
    // LLM-generated title); refresh the sidebar so "New chat" reconciles, and
    // drop the in-flight signal so a resumed reader doesn't re-open.
    onTokensConsumed?.();
    void queryClient.invalidateQueries(trpc.chat.list.queryFilter());
    void queryClient.invalidateQueries(trpc.chat.inflightTurn.queryFilter());

    const turnId = inflightTurnIdRef.current;
    inflightTurnIdRef.current = null;

    if (terminalReceivedRef.current) {
      settleLastMessage(null);
    } else {
      void reconcileOrAdopt(turnId);
    }

    setQueryInput(undefined);
  };

  // tRPC subscription: a pure reader of the durable token Stream (T5). The
  // Generation worker produces tokens out-of-band; this only tails and renders
  // them. It is opened by `send`/`stop` setting `queryInput`; the control plane
  // (send / stop / reconcileTurn) lives in the mutations below.
  // Open the reader when a local send is in-flight, while a Turn is active, or —
  // for resume-after-refresh — when the mount-time probe reports a Turn already
  // generating that this mount hasn't yet taken over.
  const shouldResume = resumedTurnId !== null && !resumeConsumedRef.current;

  useSubscription(
    trpc.chat.stream.subscriptionOptions(
      { conversationId: sessionId },
      {
        enabled: queryInput !== undefined || turnActive || shouldResume,
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
          // Resume-after-refresh: the reader opened without a local `send`
          // having armed the lifecycle (streamingRef still false), so a Turn was
          // already in-flight when we mounted. Adopt it — arm the refs from the
          // lock's turnId (so an orphan is reconciled by us) and seed a loading
          // assistant bubble after the persisted history for the Stream to fill.
          if (!streamingRef.current) {
            streamingRef.current = true;
            resumeConsumedRef.current = true;
            terminalReceivedRef.current = false;
            inflightTurnIdRef.current =
              queryClient.getQueryData<{ turnId: string | null }>(
                trpc.chat.inflightTurn.queryKey({ conversationId: sessionId }),
              )?.turnId ?? null;
            setTurnActive(true);
            setLocalMessages((prev) => prev ?? resumeSeed());
          }
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

  // Open the pure-reader subscription for a now-confirmed Turn. `ownedTurnId` is
  // the `turnId` when we own the Turn (`accepted`), or null when we only attached
  // to another tab's in-flight Turn (`alreadyInflight`) — only the owner holds a
  // turnId to reconcile/refund. Opening here (not on send) means the reader's
  // eventual close always sees the correct ownership, with no send/close race.
  const openReader = (query: string, ownedTurnId: string | null) => {
    terminalReceivedRef.current = false;
    inflightTurnIdRef.current = ownedTurnId;
    streamingRef.current = true;
    // This mount now owns the Turn lifecycle: a later (possibly stale)
    // inflightTurn result must not re-trigger a resume for it.
    resumeConsumedRef.current = true;
    setTurnActive(true);
    setQueryInput(query);
  };

  // Initiate a Turn (T4 `chat.send`). `accepted` ⇒ we own the Turn and open the
  // reader armed for reconcile; `alreadyInflight` ⇒ attach as a pure reader
  // without re-sending. A send failure (e.g. insufficient credits) opens no
  // reader and surfaces the error on the pending assistant message.
  const sendMutation = useMutation(
    trpc.chat.send.mutationOptions({
      onSuccess: (result, variables) => {
        openReader(
          variables.query,
          result.status === 'accepted' ? variables.turnId : null,
        );
      },
      onError: (error) => {
        updateLastMessageWithError();
        genericErrorHandle(error);
      },
    }),
  );

  // A Turn is in-flight from send() until settle: the send button is gated the
  // whole time (mutation pending, then the reader is open) while the input stays
  // editable so the user can draft their next message. `turnActive` also covers
  // a Turn adopted by resume-after-refresh, which this client never sent.
  const isSending =
    sendMutation.isPending || queryInput !== undefined || turnActive;

  const send = (text: string) => {
    if (isSending) return;

    // First interaction seeds `localMessages` from the derived `base` (loaded
    // history, or empty for a new Conversation); subsequent sends append to the
    // live list.
    const previous = localMessages ?? base;
    // Captured before `setLocalMessages` mutates it: is this the first send of
    // this mount? If so we stamp the deep-link URL below (only on a real send,
    // not the too-long error path) so the Conversation is resumable after a
    // refresh mid-generation.
    const isFirstSend = localMessages === null;

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

    // Stamp the deep-link URL on the first send (idempotent upstream).
    if (isFirstSend) onFirstSend?.();

    // Initiate generation; the reader opens once `chat.send` confirms the Turn.
    // `isSending` stays true through the pending mutation (send-gate closed).
    sendMutation.mutate({
      query: text,
      conversationId: sessionId,
      turnId: crypto.randomUUID(),
    });
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
    return useQuery(
      trpc.chat.get.queryOptions({ sessionId }, { meta: persistMeta }),
    );
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
