// hooks/chat-turn-reducer.ts
//
// The pure Turn state machine (#132). `useChat` used to fuse the Turn's phase
// logic with the React-Query cache writes and re-check a stale-closure `phaseRef`
// in every async callback. That logic now lives here as a pure reducer: given the
// current `TurnState` and a reader/mutation `TurnEvent`, it returns the next state
// plus a declarative list of **Cache intents** — the vocabulary of cache effects
// the hook then applies. The reducer touches NO React-Query API and reads no ref;
// it is the single source of the current phase, so a delta/close/adopt arriving
// after the Turn settled is a no-op decided HERE, not a guard scattered per
// callback.
import type { Message } from '../api/schemas/message-schema';

export const ERROR_TEXT = 'Sorry, there was an error processing your request.';

// A Turn's lifecycle from THIS client's point of view (#115):
//   idle      — no Turn from this client; render the chat.get cache as-is.
//   sending   — chat.send mutation in flight; the reader is not yet open.
//   streaming — reader open, tokens (or a resumed Turn's backlog) flowing.
//   settling  — reader closed with no terminal; reconcile/refund in progress.
export type TurnPhase = 'idle' | 'sending' | 'streaming' | 'settling';

export interface TurnState {
  phase: TurnPhase;
  // The turnId THIS client minted and got `accepted` for; null when we merely
  // attached to another tab's Turn (only the owner reconciles/refunds an orphan).
  ownedTurnId: string | null;
  // Has this mount already taken over a Turn (via send or resume-adopt)? Gates
  // `shouldResume`, so a still-cached inflightTurn can't re-trigger a phantom
  // resume once the Turn has settled.
  resumeConsumed: boolean;
}

export const initialTurnState: TurnState = {
  phase: 'idle',
  ownedTurnId: null,
  resumeConsumed: false,
};

// Events the hook feeds the reducer — reader outcomes, mutation results, and the
// results of the two authoritative-history reads the hook performs on the
// reducer's behalf (resume prefix, orphan reconcile).
export type TurnEvent =
  // A validated send begins a Turn (the too-long path never reaches here).
  | { type: 'send'; text: string }
  // chat.send resolved: `accepted` carries the owned turnId, `alreadyInflight`
  // carries null (we attached to another tab's Turn).
  | { type: 'sendResult'; ownedTurnId: string | null }
  | { type: 'sendFailed' }
  | { type: 'streamDelta'; chunk: string }
  | {
      type: 'streamTerminal';
      outcome: 'done' | 'cancelled' | 'error';
      messageId: string | null;
    }
  // The reader opened. For a resume-after-refresh the phase is still idle, so we
  // adopt the Turn the lock reports; a reconnect during our own Turn (already
  // streaming) is a no-op.
  | { type: 'readerStarted'; inflightTurnId: string | null }
  // The resume-prefix read resolved (null when it failed / was unreadable).
  | { type: 'historyPrefixLoaded'; history: Message[] | null }
  // The reader closed with no terminal (clean drain or unrecoverable error).
  | { type: 'readerClosed' }
  // The orphan-reconcile read resolved (null when history was unreadable).
  | { type: 'historyReconciled'; history: Message[] | null }
  // chat.stop resolved.
  | { type: 'stopped' };

// Cache intents — the declarative vocabulary the hook interprets against the
// three caches (chat.get / chat.list / chat.inflightTurn) and the credit/reconcile
// side-effects. The reducer only NAMES the effect; the hook owns the mechanism.
export type CacheIntent =
  // chat.get writers
  | { kind: 'optimisticUserTurn'; text: string }
  | { kind: 'validationError'; text: string; message: string }
  | { kind: 'appendDelta'; chunk: string }
  | { kind: 'settleAssistant'; messageId: string | null }
  | { kind: 'errorAssistant' }
  | { kind: 'ensureLoadingAssistant' }
  | { kind: 'spliceHistoryPrefix'; history: Message[] }
  | { kind: 'adoptHistory'; history: Message[] }
  | { kind: 'cancelHistoryFetch' }
  // chat.list writer
  | { kind: 'upsertConversation' }
  // settle side-effects: fold server truth back into the caches a Turn touched.
  | { kind: 'invalidateList' }
  | { kind: 'invalidateInflight' }
  | { kind: 'refreshCredits' }
  // orphan recovery: refund + teardown the Turn we own.
  | { kind: 'reconcileTurn'; turnId: string }
  // authoritative-history reads the hook performs, re-dispatching the result.
  | { kind: 'readHistoryForPrefix' }
  | { kind: 'readHistoryForReconcile' };

// Side-effects shared by every settled Turn: refresh the credit counter and fold
// server truth back into the sidebar + in-flight probe. chat.get is deliberately
// NOT invalidated — the Stream already wrote the finished Turn into its cache.
const FINISH_INTENTS: CacheIntent[] = [
  { kind: 'refreshCredits' },
  { kind: 'invalidateList' },
  { kind: 'invalidateInflight' },
];

// Every user Turn resolves into one assistant Message; equal counts ⇒ the pending
// Turn produced its answer, so a terminal-less close was a missed terminal (adopt
// server truth) rather than a true orphan.
const isAnsweredHistory = (history: Message[]) => {
  const users = history.filter((m) => m.role === 'user').length;
  const assistants = history.filter((m) => m.role === 'assistant').length;
  return users > 0 && assistants >= users;
};

export interface TurnReducerResult {
  state: TurnState;
  intents: CacheIntent[];
}

// A guarded no-op: an event that doesn't apply to the current phase leaves the
// state untouched and emits nothing. This is how the reducer subsumes the old
// per-callback `phaseRef` re-checks — a late delta/close/adopt lands HERE.
const noop = (state: TurnState): TurnReducerResult => ({ state, intents: [] });

type EventOf<T extends TurnEvent['type']> = Extract<TurnEvent, { type: T }>;

const reduceSend = (
  state: TurnState,
  event: EventOf<'send'>,
): TurnReducerResult =>
  state.phase === 'idle'
    ? {
        state: { ...state, phase: 'sending' },
        intents: [
          { kind: 'optimisticUserTurn', text: event.text },
          { kind: 'upsertConversation' },
        ],
      }
    : noop(state);

const reduceSendResult = (
  state: TurnState,
  event: EventOf<'sendResult'>,
): TurnReducerResult =>
  state.phase === 'sending'
    ? {
        state: {
          phase: 'streaming',
          ownedTurnId: event.ownedTurnId,
          resumeConsumed: true,
        },
        intents: [],
      }
    : noop(state);

const reduceSendFailed = (state: TurnState): TurnReducerResult =>
  state.phase === 'sending'
    ? {
        state: { ...state, phase: 'idle' },
        intents: [{ kind: 'errorAssistant' }],
      }
    : noop(state);

const reduceStreamDelta = (
  state: TurnState,
  event: EventOf<'streamDelta'>,
): TurnReducerResult =>
  state.phase === 'streaming'
    ? { state, intents: [{ kind: 'appendDelta', chunk: event.chunk }] }
    : noop(state);

const reduceStreamTerminal = (
  state: TurnState,
  event: EventOf<'streamTerminal'>,
): TurnReducerResult =>
  state.phase === 'streaming'
    ? {
        state: { ...state, phase: 'idle', ownedTurnId: null },
        intents: [
          event.outcome === 'error'
            ? { kind: 'errorAssistant' }
            : { kind: 'settleAssistant', messageId: event.messageId },
          ...FINISH_INTENTS,
        ],
      }
    : noop(state);

// A reconnect during our own Turn (already streaming) keeps flowing; otherwise
// this is resume-after-refresh — adopt the Turn the lock reports, ensure a
// loading bubble the Stream can fill, and splice the authoritative prefix in
// front WITHOUT letting the mount fetch clobber the deltas.
const reduceReaderStarted = (
  state: TurnState,
  event: EventOf<'readerStarted'>,
): TurnReducerResult =>
  state.phase === 'streaming'
    ? noop(state)
    : {
        state: {
          phase: 'streaming',
          ownedTurnId: event.inflightTurnId,
          resumeConsumed: true,
        },
        intents: [
          { kind: 'cancelHistoryFetch' },
          { kind: 'ensureLoadingAssistant' },
          { kind: 'readHistoryForPrefix' },
        ],
      };

const reduceHistoryPrefixLoaded = (
  state: TurnState,
  event: EventOf<'historyPrefixLoaded'>,
): TurnReducerResult =>
  state.phase === 'streaming' && event.history !== null
    ? {
        state,
        intents: [{ kind: 'spliceHistoryPrefix', history: event.history }],
      }
    : noop(state);

// A stale close from a torn-down reader — or the `idle` that trails a terminal —
// does nothing; only a live streaming Turn triggers reconcile.
const reduceReaderClosed = (state: TurnState): TurnReducerResult =>
  state.phase === 'streaming'
    ? {
        state: { ...state, phase: 'settling' },
        intents: [{ kind: 'readHistoryForReconcile' }],
      }
    : noop(state);

const reduceHistoryReconciled = (
  state: TurnState,
  event: EventOf<'historyReconciled'>,
): TurnReducerResult => {
  if (state.phase !== 'settling') return noop(state);
  const next: TurnState = { ...state, phase: 'idle', ownedTurnId: null };
  // Missed terminal: the answer is persisted, so adopt server truth.
  if (event.history !== null && isAnsweredHistory(event.history)) {
    return {
      state: next,
      intents: [
        { kind: 'adoptHistory', history: event.history },
        ...FINISH_INTENTS,
      ],
    };
  }
  // True orphan: mark the bubble errored and reconcile+refund the Turn we own
  // (an attached-only client has no turnId and nothing to refund).
  const reconcile: CacheIntent[] =
    state.ownedTurnId === null
      ? []
      : [{ kind: 'reconcileTurn', turnId: state.ownedTurnId }];
  return {
    state: next,
    intents: [{ kind: 'errorAssistant' }, ...reconcile, ...FINISH_INTENTS],
  };
};

const reduceStopped = (state: TurnState): TurnReducerResult =>
  state.phase === 'streaming'
    ? {
        state: { ...state, phase: 'idle', ownedTurnId: null },
        intents: [
          { kind: 'settleAssistant', messageId: null },
          ...FINISH_INTENTS,
        ],
      }
    : noop(state);

export function turnReducer(
  state: TurnState,
  event: TurnEvent,
): TurnReducerResult {
  switch (event.type) {
    case 'send': {
      return reduceSend(state, event);
    }
    case 'sendResult': {
      return reduceSendResult(state, event);
    }
    case 'sendFailed': {
      return reduceSendFailed(state);
    }
    case 'streamDelta': {
      return reduceStreamDelta(state, event);
    }
    case 'streamTerminal': {
      return reduceStreamTerminal(state, event);
    }
    case 'readerStarted': {
      return reduceReaderStarted(state, event);
    }
    case 'historyPrefixLoaded': {
      return reduceHistoryPrefixLoaded(state, event);
    }
    case 'readerClosed': {
      return reduceReaderClosed(state);
    }
    case 'historyReconciled': {
      return reduceHistoryReconciled(state, event);
    }
    case 'stopped': {
      return reduceStopped(state);
    }
  }
}

// Wedged-Turn view derivation (#115, #132). Pure: when this client holds no live
// Turn (idle, not resuming) and the probe says nothing is in flight, but the
// authoritative history ends on a user Message with no assistant reply, the Turn
// wedged (a worker died and the lock TTL lapsed before any reader could reconcile
// it). Synthesize an error bubble rather than stalling silently — a later refetch
// that carries the answer simply drops it. `historyFetching` defers the verdict
// until the mount revalidation settles, so a refresh landing mid-finalize does not
// flash a spurious error before the refetch delivers the assistant Message.
export interface DeriveMessagesInput {
  phase: TurnPhase;
  base: Message[];
  resumedTurnId: string | null;
  inflightSuccess: boolean;
  historyFetching: boolean;
}

export function isWedgedTurn({
  phase,
  base,
  resumedTurnId,
  inflightSuccess,
  historyFetching,
}: DeriveMessagesInput) {
  return (
    phase === 'idle' &&
    resumedTurnId === null &&
    inflightSuccess &&
    !historyFetching &&
    base.length > 0 &&
    base.at(-1)?.role === 'user'
  );
}

export function deriveMessages(input: DeriveMessagesInput): Message[] {
  if (!isWedgedTurn(input)) return input.base;
  return [
    ...input.base,
    { text: ERROR_TEXT, role: 'assistant', loading: false, error: true },
  ];
}
