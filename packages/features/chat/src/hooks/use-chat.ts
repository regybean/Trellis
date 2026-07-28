// hooks/use-chat.ts
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { toast } from 'react-toastify';

import { persistMeta, useGenericErrorHandler } from '@acme/hooks';

import type { SelectConversationSummary } from '../api/schemas/chat-schema';
import type { Message } from '../api/schemas/message-schema';
import type { CacheIntent, TurnEvent } from './chat-turn-reducer';
import { MAX_MESSAGE_LENGTH } from '../api/schemas/chat-schema';
import { useChatQueryClient, useTRPC, useTRPCClient } from '../trpc/react';
import {
  deriveMessages,
  ERROR_TEXT,
  initialTurnState,
  turnReducer,
} from './chat-turn-reducer';

// A fresh loading assistant bubble for the Stream to fill.
const loadingAssistant = () =>
  ({
    text: '',
    role: 'assistant',
    loading: true,
    error: false,
  }) satisfies Message;

export function useChat(
  sessionId: string,
  onTokensConsumed?: () => void,
  onSend?: () => void,
) {
  const genericErrorHandle = useGenericErrorHandler();
  const trpc = useTRPC();
  // A vanilla (non-hook) tRPC client for cache-free reads: the resume-adopt and
  // orphan paths must read authoritative history WITHOUT the fetch writing the
  // chat.get cache, or it would clobber the assistant bubble mid-stream.
  const trpcClient = useTRPCClient();
  // Pin to chat's own QueryClient (the persister-bearing one), not the nearest
  // provider in context — see useChatQueryClient / #82.
  const queryClient = useChatQueryClient();
  const scrollToBottomRef = useRef<(() => void) | null>(null);

  // The Turn state machine (#132). All phase/ownership decisions live in the pure
  // reducer; the hook holds the state for render and a mirror ref for the
  // synchronous reads inside async reader/mutation callbacks (where React state is
  // a stale closure). Every transition goes through `dispatch`, so the reducer —
  // not a scattered `phaseRef` re-check — is the single source of the phase.
  const [turnState, setTurnState] = useState(initialTurnState);
  const stateRef = useRef(turnState);

  const getKey = trpc.chat.get.queryKey({ sessionId });

  // Resuming a Conversation: its persisted Messages. A brand-new Conversation
  // has no thread yet, so `get` returns `[]` (not an error) — "show an empty
  // pane". `retry: false` fails fast and any rejection stays silent. Keyed by
  // sessionId (the component remounts per Conversation). THIS query's cache is
  // the single source of truth for the rendered Messages (#115): `send` seeds
  // the optimistic user Message + a loading assistant bubble into it, and the
  // Stream appends deltas into the same entry — there is no separate sticky copy
  // to reconcile. The Turn's finished Messages are already in this cache, so the
  // persister keeps a current snapshot for the next cold open. The cache is
  // revalidated on every mount (`staleTime: 0` on chat's QueryClient makes the
  // persister's post-restore refetch always fire) so a stale persisted snapshot
  // never survives a refresh — see query-client.ts.
  const historyQuery = useQuery(
    trpc.chat.get.queryOptions(
      { sessionId },
      { retry: false, meta: persistMeta },
    ),
    queryClient,
  );

  // Resume-after-refresh probe: is a Turn already generating for this
  // Conversation (the In-flight lock's turnId)? If so we reopen the pure reader
  // and adopt the Turn even though THIS client never sent it — the token Stream
  // is durable. Never persisted (volatile), keyed by sessionId so it never leaks
  // a stale in-flight signal across Conversations.
  const inflightQuery = useQuery(
    trpc.chat.inflightTurn.queryOptions({ conversationId: sessionId }),
    queryClient,
  );
  const resumedTurnId = inflightQuery.data?.turnId ?? null;

  const base = historyQuery.data ?? [];

  // Rendered Messages = the chat.get cache, with a synthetic error bubble spliced
  // in for a wedged Turn (pure view derivation — no cache write; see reducer).
  const messages = deriveMessages({
    phase: turnState.phase,
    base,
    resumedTurnId,
    inflightSuccess: inflightQuery.isSuccess,
    historyFetching: historyQuery.isFetching,
  });

  // Skeleton whenever there is nothing to show yet AND a fetch is resolving — the
  // initial load, but also the mount revalidation of a stale/empty persisted
  // snapshot. Keying on `isFetching` (not just the no-data `isLoading`) is what
  // stops a refresh from flashing the empty greeting pane before the refetch
  // lands. A *settled* empty result (not fetching) falls through to the empty
  // pane; once a Turn is live (`phase !== 'idle'`) the streaming bubble renders.
  const isHistoryLoading =
    turnState.phase === 'idle' && base.length === 0 && historyQuery.isFetching;

  // ── chat.get cache writers (the single source of truth) ───────────────────
  const setMessages = (updater: (prev: Message[]) => Message[]) => {
    queryClient.setQueryData(getKey, (prev) => updater(prev ?? []));
  };

  const appendToLastAssistant = (chunk: string) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1
          ? { ...m, text: m.text + chunk, loading: false }
          : m,
      ),
    );
  };

  // Stamp the last (assistant) Message settled — the persisted `messageId` from
  // a terminal (so feedback can attach without a refetch) or just cleared of its
  // loading flag.
  const settleLastAssistant = (messageId: string | null) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1
          ? { ...m, id: messageId ?? m.id, sessionId, loading: false }
          : m,
      ),
    );
  };

  const markLastAssistantError = () => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === prev.length - 1
          ? { ...m, error: true, loading: false, text: ERROR_TEXT }
          : m,
      ),
    );
  };

  // The Conversation History sidebar reads `chat.list`. On the first send of a
  // new Conversation prepend a "New chat" placeholder; a resend bumps the
  // existing row to the top with a fresh `updatedAt`. The real (LLM-generated)
  // title arrives when the list is invalidated on settle.
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

  // Idempotent orphan cleanup + refund. Fired by the reducer's `reconcileTurn`
  // intent when the reader closed without a terminal and THIS client owns the
  // Turn; the toast tells the user why the response vanished and that they were
  // not charged.
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

  // ── Turn state machine wiring ─────────────────────────────────────────────
  // `dispatch` runs the reducer against the mirror ref (sync-correct in async
  // callbacks), commits the next state, then applies each returned Cache intent.
  // Declared as functions (not arrow consts) so `applyIntent` and `dispatch` can
  // reference each other — the two history-read intents re-dispatch their result.
  function dispatch(event: TurnEvent) {
    const { nextState, intents } = turnReducer(stateRef.current, event);
    stateRef.current = nextState;
    setTurnState(nextState);
    for (const intent of intents) applyIntent(intent);
  }

  // Pull authoritative history via the vanilla client — no cache write, so the
  // streaming bubble is never clobbered — and re-dispatch the result; a failed
  // read becomes null, which the reducer treats as its own path. Shared by the
  // resume-prefix and orphan-reconcile intents (they differ only in the event).
  function readHistory(toEvent: (history: Message[] | null) => TurnEvent) {
    void (async () => {
      let history: Message[] | null = null;
      try {
        history = await trpcClient.chat.get.query({ sessionId });
      } catch {
        history = null;
      }
      dispatch(toEvent(history));
    })();
  }

  function applyIntent(intent: CacheIntent) {
    switch (intent.kind) {
      case 'optimisticUserTurn': {
        // Cancel any in-flight history fetch first so it can't resolve and
        // clobber the optimistic write.
        void queryClient.cancelQueries(
          trpc.chat.get.queryFilter({ sessionId }),
        );
        setMessages((prev) => [
          ...prev,
          { text: intent.text, role: 'user', loading: false, error: false },
          loadingAssistant(),
        ]);
        return;
      }
      case 'appendDelta': {
        appendToLastAssistant(intent.chunk);
        return;
      }
      case 'settleAssistant': {
        settleLastAssistant(intent.messageId);
        return;
      }
      case 'errorAssistant': {
        markLastAssistantError();
        return;
      }
      case 'ensureLoadingAssistant': {
        setMessages((prev) => {
          const tail = prev.at(-1);
          if (tail?.role === 'assistant' && tail.loading) return prev;
          return [...prev, loadingAssistant()];
        });
        return;
      }
      case 'spliceHistoryPrefix': {
        // Splice the fresh persisted prefix in front of the still-filling
        // assistant bubble. The tail guard is data-dependent; the phase guard
        // that used to sit here is now the reducer's job.
        setMessages((prev) => {
          const tail = prev.at(-1);
          if (tail?.role !== 'assistant') return prev;
          return [...intent.history, tail];
        });
        return;
      }
      case 'adoptHistory': {
        queryClient.setQueryData(getKey, intent.history);
        return;
      }
      case 'cancelHistoryFetch': {
        void queryClient.cancelQueries(
          trpc.chat.get.queryFilter({ sessionId }),
        );
        return;
      }
      case 'upsertConversation': {
        upsertConversationInList();
        return;
      }
      case 'invalidateList': {
        void queryClient.invalidateQueries(trpc.chat.list.queryFilter());
        return;
      }
      case 'invalidateInflight': {
        void queryClient.invalidateQueries(
          trpc.chat.inflightTurn.queryFilter(),
        );
        return;
      }
      case 'refreshCredits': {
        onTokensConsumed?.();
        return;
      }
      case 'reconcileTurn': {
        reconcileMutation.mutate({
          conversationId: sessionId,
          turnId: intent.turnId,
        });
        return;
      }
      case 'readHistoryForPrefix': {
        // A failed read keeps the optimistic bubble (null → reducer no-op).
        readHistory((history) => ({ type: 'historyPrefixLoaded', history }));
        return;
      }
      case 'readHistoryForReconcile': {
        // The reducer decides adopt-vs-refund from the returned counts; a failed
        // read (null) is treated as the orphan path.
        readHistory((history) => ({ type: 'historyReconciled', history }));
        return;
      }
    }
  }

  // Open the pure-reader subscription when a Turn is live from this client
  // (`streaming`) or — for resume-after-refresh — when the mount probe reports a
  // Turn already generating that this mount hasn't taken over.
  const shouldResume =
    resumedTurnId !== null &&
    !turnState.resumeConsumed &&
    turnState.phase === 'idle';

  // Callbacks are spread onto the hook (not `subscriptionOptions`'s opts arg) so
  // the react-hooks/refs rule sees the ref-reading closures passed straight to a
  // hook — which defers them — rather than to a plain function it must assume
  // could run during render.
  useSubscription({
    ...trpc.chat.stream.subscriptionOptions({ conversationId: sessionId }),
    enabled: turnState.phase === 'streaming' || shouldResume,
    onData: ({ data: event }) => {
      if (event.type === 'delta') {
        dispatch({ type: 'streamDelta', chunk: event.chunk });
        return;
      }
      dispatch({
        type: 'streamTerminal',
        outcome: event.type,
        messageId: event.type === 'error' ? null : event.messageId,
      });
    },
    onStarted: () => {
      // Resume-after-refresh adoption is decided by the reducer; it reads the
      // lock's turnId from the (already-fetched) inflightTurn cache.
      dispatch({
        type: 'readerStarted',
        inflightTurnId:
          queryClient.getQueryData<{ turnId: string | null }>(
            trpc.chat.inflightTurn.queryKey({ conversationId: sessionId }),
          )?.turnId ?? null,
      });
      // Scroll to bottom after starting.
      setTimeout(() => scrollToBottomRef.current?.(), 0);
    },
    // The reader failed unrecoverably (tRPC transparently retries recoverable
    // drops, so this is terminal). Treat as a stream close.
    onError: () => dispatch({ type: 'readerClosed' }),
    // A clean server-side close drains to `idle`; treat as a close too, so a
    // normal completion whose terminal was missed and an orphaned close share
    // one path.
    onConnectionStateChange: (data) => {
      if (data.state === 'idle') dispatch({ type: 'readerClosed' });
    },
  });

  // Callbacks spread onto the hook (not the `mutationOptions` opts arg) for the
  // same react-hooks/refs reason as the subscription above.
  const sendMutation = useMutation({
    ...trpc.chat.send.mutationOptions(),
    onSuccess: (result, variables) => {
      // `accepted` ⇒ we own the Turn (its turnId); `alreadyInflight` ⇒ we merely
      // attached to another tab's Turn (null).
      dispatch({
        type: 'sendResult',
        ownedTurnId: result.status === 'accepted' ? variables.turnId : null,
      });
    },
    onError: (error) => {
      dispatch({ type: 'sendFailed' });
      genericErrorHandle(error);
    },
  });

  // A Turn is in-flight from send() until settle: the send button is gated the
  // whole time (mutation pending, reader open, or reconcile settling) while the
  // input stays editable so the user can draft their next message. Also covers a
  // Turn adopted by resume-after-refresh, which this client never sent.
  const isSending = turnState.phase !== 'idle';

  const send = (text: string) => {
    if (stateRef.current.phase !== 'idle') return;

    // Validate length before sending — the URL carries the sessionId and an
    // over-long message would overflow it. Write the error straight into the
    // cache (our single render source) without starting a Turn — no Turn means
    // no reducer transition, so this stays a plain cache write, not an intent.
    // Unsent, so a later chat.get refetch drops it.
    if (text.length > MAX_MESSAGE_LENGTH) {
      setMessages((prev) => [
        ...prev,
        { text, role: 'user', loading: false, error: false },
        {
          text: `Message is too long (${text.length} characters). Please keep messages under ${MAX_MESSAGE_LENGTH} characters.`,
          role: 'assistant',
          loading: false,
          error: true,
        },
      ]);
      return;
    }

    // Optimistically render the user Message + a loading assistant bubble and
    // surface the Conversation in the history sidebar (both via the reducer's
    // intents). `chat.send` persists the user Message server-side; the worker
    // fills the assistant via the Stream, appended into this same cache entry.
    dispatch({ type: 'send', text });

    // Ask the parent to stamp the deep-link URL so the Conversation survives a
    // mid-generation refresh. Fires on every send (the single-source-of-truth
    // rework dropped the first-send signal, #115); the caller's stamp is
    // idempotent — a no-op once the URL already matches — so resends are free.
    onSend?.();

    sendMutation.mutate({
      query: text,
      conversationId: sessionId,
      turnId: crypto.randomUUID(),
    });
  };

  // Cancel the in-flight Turn (chat.stop). The worker also emits a `cancelled`
  // terminal via the Stream, but we settle the UI now; the reducer's `stopped`
  // transition moves the phase to idle, so the closing reader's streaming guard
  // keeps it from being mistaken for an orphan.
  const stopMutation = useMutation({
    ...trpc.chat.stop.mutationOptions(),
    onSuccess: () => dispatch({ type: 'stopped' }),
    onError: (error) => genericErrorHandle(error),
  });

  const stop = () => {
    if (stateRef.current.phase !== 'streaming') return;
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

  return {
    messages,
    isLoading: isSending,
    isSending,
    isHistoryLoading,
    send,
    stop,
    scrollToBottomRef,
    deleteChat,
  };
}
