// hooks/use-chat.ts
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { toast } from 'react-toastify';

import { persistMeta, useGenericErrorHandler } from '@acme/hooks';

import type { SelectConversationSummary } from '../api/schemas/chat-schema';
import type { Message } from '../api/schemas/message-schema';
import { MAX_MESSAGE_LENGTH } from '../api/schemas/chat-schema';
import { useChatQueryClient, useTRPC, useTRPCClient } from '../trpc/react';

// A Turn's lifecycle from THIS client's point of view, in a single value (#115).
// Everything the UI needs — the send-gate (`isSending`), the reader `enabled`
// flag, and the settle guard — derives from `phase`:
//   idle      — no Turn from this client; render the chat.get cache as-is.
//   sending   — chat.send mutation in flight; the reader is not yet open.
//   streaming — reader open, tokens (or a resumed Turn's backlog) flowing.
//   settling  — reader closed with no terminal; reconcile/refund in progress.
type Phase = 'idle' | 'sending' | 'streaming' | 'settling';

const ERROR_TEXT = 'Sorry, there was an error processing your request.';

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

  // The single render-visible Turn state (#115). `phaseRef` mirrors it for the
  // synchronous reads inside the subscription/mutation callbacks, where React
  // state would be a stale closure.
  const [phase, setPhaseState] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  // Turn bookkeeping read ONLY inside async callbacks, so a ref (not state):
  // `ownedTurnIdRef` is the turnId THIS client minted and got `accepted` for;
  // null when we merely attached to another tab's Turn. Only the owner
  // reconciles/refunds an orphan.
  const ownedTurnIdRef = useRef<string | null>(null);
  // Has this mount already taken over a Turn (via send or resume-adopt)? Gates
  // `shouldResume` (read in render → state, not a ref), so a still-cached
  // inflightTurn can't re-trigger a phantom resume once the Turn has settled.
  const [resumeConsumed, setResumeConsumed] = useState(false);

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

  // Wedged-Turn detection (#115). When this client holds no live Turn (idle, not
  // resuming) and the probe says nothing is in flight, but the authoritative
  // history ends on a user Message with no assistant reply, the Turn wedged — a
  // worker died and the lock TTL lapsed before any reader could reconcile it, so
  // no reader will ever open to surface the failure. Show an error bubble rather
  // than stalling silently. Pure derivation (no effect, no cache write): a later
  // refetch that carries the answer simply drops it.
  // `!historyQuery.isFetching` defers the verdict until the mount revalidation
  // settles: a refresh that lands mid-finalize (lock released, assistant not yet
  // persisted) would otherwise read `[user]` + `inflightTurn: null` and flash a
  // spurious error before the refetch delivers the assistant Message.
  const isWedged =
    phase === 'idle' &&
    resumedTurnId === null &&
    inflightQuery.isSuccess &&
    !historyQuery.isFetching &&
    base.length > 0 &&
    base.at(-1)?.role === 'user';

  const messages: Message[] = isWedged
    ? [
        ...base,
        { text: ERROR_TEXT, role: 'assistant', loading: false, error: true },
      ]
    : base;

  // Skeleton whenever there is nothing to show yet AND a fetch is resolving — the
  // initial load, but also the mount revalidation of a stale/empty persisted
  // snapshot. Keying on `isFetching` (not just the no-data `isLoading`) is what
  // stops a refresh from flashing the empty greeting pane before the refetch
  // lands: right as a Turn settles the resume path stops repainting `base`,
  // exposing that refetch window. A *settled* empty result (not fetching) falls
  // through to the empty pane; once a Turn is live (`phase !== 'idle'`) the
  // streaming bubble renders instead.
  const isHistoryLoading =
    phase === 'idle' && base.length === 0 && historyQuery.isFetching;

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

  // Idempotent orphan cleanup + refund. Called when the reader closed without a
  // terminal and THIS client owns the Turn; the toast tells the user why the
  // response vanished and that they were not charged.
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

  // Side-effects shared by every settled Turn: refresh the credit counter and
  // fold server truth back into the caches the Turn touched — the sidebar (so
  // "New chat" reconciles to the generated title) and the in-flight probe (so a
  // resumed reader doesn't re-open). chat.get is deliberately NOT invalidated:
  // the Stream already wrote the finished Turn into its cache, so a refetch would
  // only flicker the just-rendered Messages.
  const finishTurn = () => {
    onTokensConsumed?.();
    void queryClient.invalidateQueries(trpc.chat.list.queryFilter());
    void queryClient.invalidateQueries(trpc.chat.inflightTurn.queryFilter());
    ownedTurnIdRef.current = null;
    setPhase('idle');
  };

  // Reader closed with no terminal. Either the Turn orphaned (worker died) or it
  // completed but this reader — typically a resumed one — attached after the
  // Stream's post-terminal TTL and missed the terminal. chat.get is
  // authoritative: read it fresh via the vanilla client (so the in-flight bubble
  // in the cache isn't clobbered by the fetch). If the assistant Message is now
  // persisted, adopt server truth into the cache; else the Turn really failed —
  // mark the bubble errored and reconcile + refund the Turn we own (an
  // attached-only client has no turnId and nothing to refund).
  const reconcileOrAdopt = async (turnId: string | null) => {
    try {
      const persisted = await trpcClient.chat.get.query({ sessionId });
      const users = persisted.filter((m) => m.role === 'user').length;
      const assistants = persisted.filter((m) => m.role === 'assistant').length;
      // Every user Turn resolves into one assistant Message; equal counts ⇒ the
      // pending Turn produced its answer, so this was a missed terminal.
      if (assistants >= users && users > 0) {
        queryClient.setQueryData(getKey, persisted);
        return;
      }
    } catch {
      // Fall through to the orphan path if history can't be read.
    }
    markLastAssistantError();
    if (turnId) reconcileMutation.mutate({ conversationId: sessionId, turnId });
  };

  // A reader close (a clean drain to `idle`, or an unrecoverable `onError`).
  // With a terminal already seen the Turn settled on that event, so this is a
  // no-op; without one it is the orphan / missed-terminal trigger. Guarded on
  // `phase === 'streaming'` so a stale close from a torn-down reader — or the
  // `idle` that trails a terminal — does nothing.
  const handleReaderClose = () => {
    if (phaseRef.current !== 'streaming') return;
    setPhase('settling');
    void reconcileOrAdopt(ownedTurnIdRef.current).finally(finishTurn);
  };

  // Resume-adopt: pull authoritative history WITHOUT clobbering the streaming
  // bubble (vanilla client read → no cache write), then splice the fresh
  // persisted prefix in front of the still-filling assistant bubble. Replaces
  // the old resumeSeed → adoptFreshHistory dance now that the cache is the
  // single source of truth (#115): on a first-Turn reload the cached chat.get
  // may be a stale persisted `[]`, so this forces the persisted user Message to
  // show. Guarded so a read resolving after settle can't duplicate the assistant.
  const refreshHistoryPrefix = async () => {
    let fresh: Message[];
    try {
      fresh = await trpcClient.chat.get.query({ sessionId });
    } catch {
      return; // keep the optimistic bubble
    }
    setMessages((prev) => {
      if (phaseRef.current !== 'streaming') return prev;
      const tail = prev.at(-1);
      if (tail?.role !== 'assistant') return prev;
      return [...fresh, tail];
    });
  };

  // Open the pure-reader subscription when a Turn is live from this client
  // (`streaming`) or — for resume-after-refresh — when the mount probe reports a
  // Turn already generating that this mount hasn't taken over.
  const shouldResume =
    resumedTurnId !== null && !resumeConsumed && phase === 'idle';

  // Callbacks are spread onto the hook (not `subscriptionOptions`'s opts arg) so
  // the react-hooks/refs rule sees the ref-reading closures passed straight to a
  // hook — which defers them — rather than to a plain function it must assume
  // could run during render.
  useSubscription({
    ...trpc.chat.stream.subscriptionOptions({ conversationId: sessionId }),
    enabled: phase === 'streaming' || shouldResume,
    onData: ({ data: event }) => {
      // Ignore events from a torn-down reader once the Turn has settled.
      if (phaseRef.current !== 'streaming') return;
      if (event.type === 'done' || event.type === 'cancelled') {
        settleLastAssistant(event.messageId);
        finishTurn();
        return;
      }
      if (event.type === 'error') {
        markLastAssistantError();
        finishTurn();
        return;
      }
      appendToLastAssistant(event.chunk);
    },
    onStarted: () => {
      // Resume-after-refresh: the reader opened without a local `send` having
      // armed the lifecycle (phase still idle), so a Turn was already
      // in-flight when we mounted. Adopt it — arm `ownedTurnIdRef` from the
      // lock's turnId (so an orphan is reconciled by us) and ensure a loading
      // assistant bubble the Stream can fill. A reconnect during our own Turn
      // (phase already streaming) skips this.
      if (phaseRef.current !== 'streaming') {
        setResumeConsumed(true);
        ownedTurnIdRef.current =
          queryClient.getQueryData<{ turnId: string | null }>(
            trpc.chat.inflightTurn.queryKey({ conversationId: sessionId }),
          )?.turnId ?? null;
        setPhase('streaming');
        // Cancel the mount-time chat.get fetch so it can't resolve and clobber
        // the bubble/deltas we're about to stream in; refreshHistoryPrefix
        // supplies the authoritative prefix instead.
        void queryClient.cancelQueries(
          trpc.chat.get.queryFilter({ sessionId }),
        );
        setMessages((prev) => {
          const tail = prev.at(-1);
          if (tail?.role === 'assistant' && tail.loading) return prev;
          return [...prev, loadingAssistant()];
        });
        void refreshHistoryPrefix();
      }
      // Scroll to bottom after starting.
      setTimeout(() => scrollToBottomRef.current?.(), 0);
    },
    // The reader failed unrecoverably (tRPC transparently retries recoverable
    // drops, so this is terminal). Treat as a stream close.
    onError: () => handleReaderClose(),
    // A clean server-side close drains to `idle`; treat as a close too, so a
    // normal completion whose terminal was missed and an orphaned close share
    // one path.
    onConnectionStateChange: (data) => {
      if (data.state === 'idle') handleReaderClose();
    },
  });

  // Confirm the Turn and open the reader. `ownedTurnId` is the `turnId` when we
  // own the Turn (`accepted`), or null when we only attached to another tab's
  // in-flight Turn (`alreadyInflight`). Opening here (not on send) means the
  // reader's eventual close always sees the correct ownership.
  const openReader = (ownedTurnId: string | null) => {
    ownedTurnIdRef.current = ownedTurnId;
    // This mount now owns the Turn lifecycle: a later (possibly stale)
    // inflightTurn result must not re-trigger a resume for it.
    setResumeConsumed(true);
    setPhase('streaming');
  };

  // Callbacks spread onto the hook (not the `mutationOptions` opts arg) for the
  // same react-hooks/refs reason as the subscription above.
  const sendMutation = useMutation({
    ...trpc.chat.send.mutationOptions(),
    onSuccess: (result, variables) => {
      openReader(result.status === 'accepted' ? variables.turnId : null);
    },
    onError: (error) => {
      markLastAssistantError();
      setPhase('idle');
      genericErrorHandle(error);
    },
  });

  // A Turn is in-flight from send() until settle: the send button is gated the
  // whole time (mutation pending, reader open, or reconcile settling) while the
  // input stays editable so the user can draft their next message. Also covers a
  // Turn adopted by resume-after-refresh, which this client never sent.
  const isSending = phase !== 'idle';

  const send = (text: string) => {
    if (isSending) return;

    // Validate length before sending — the URL carries the sessionId and an
    // over-long message would overflow it. Show the error inline (into the
    // cache, our single render source) without starting a Turn. Unsent, so a
    // later chat.get refetch drops it.
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

    // Optimistically render the user Message + a loading assistant bubble into
    // the chat.get cache (#115). Cancel any in-flight history fetch first so it
    // can't resolve and clobber the optimistic write. `chat.send` persists the
    // user Message server-side; the worker fills the assistant via the Stream,
    // appended into this same cache entry.
    void queryClient.cancelQueries(trpc.chat.get.queryFilter({ sessionId }));
    setMessages((prev) => [
      ...prev,
      { text, role: 'user', loading: false, error: false },
      loadingAssistant(),
    ]);

    // Surface the Conversation in the history sidebar right away.
    upsertConversationInList();

    // Ask the parent to stamp the deep-link URL so the Conversation survives a
    // mid-generation refresh. Fires on every send (the single-source-of-truth
    // rework dropped the first-send signal, #115); the caller's stamp is
    // idempotent — a no-op once the URL already matches — so resends are free.
    onSend?.();

    setPhase('sending');
    sendMutation.mutate({
      query: text,
      conversationId: sessionId,
      turnId: crypto.randomUUID(),
    });
  };

  // Cancel the in-flight Turn (chat.stop). The worker also emits a `cancelled`
  // terminal via the Stream, but we settle the UI now; `finishTurn` moves the
  // phase to idle, so the closing reader's `phase === 'streaming'` guard keeps
  // it from being mistaken for an orphan.
  const stopMutation = useMutation({
    ...trpc.chat.stop.mutationOptions(),
    onSuccess: () => {
      settleLastAssistant(null);
      finishTurn();
    },
    onError: (error) => genericErrorHandle(error),
  });

  const stop = () => {
    if (phaseRef.current !== 'streaming') return;
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
