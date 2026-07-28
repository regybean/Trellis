/**
 * Client Turn state machine — unit (#132, ADR 0018 tier 3).
 *
 * Pure input→output over the reducer: given a `TurnState` + a reader/mutation
 * `TurnEvent`, assert the next state and the declarative Cache intents. No React,
 * no QueryClient, no MSW — the reducer imports no React-Query API, so it is tested
 * in isolation from the hook that applies its intents. Covers the four transition
 * families the ticket documents (normal / wedged / resume / orphan) plus the
 * phase-guard no-ops that subsume the old `phaseRef` re-checks.
 */
import { describe, expect, it } from 'vitest';

import type { Message } from '../../../api/schemas/message-schema';
import type { TurnState } from '../../../hooks/chat-turn-reducer';
import {
  deriveMessages,
  initialTurnState,
  turnReducer,
} from '../../../hooks/chat-turn-reducer';

const TURN = '00000000-0000-4000-8000-0000000000a1';

const streaming = (ownedTurnId: string | null): TurnState => ({
  phase: 'streaming',
  ownedTurnId,
  resumeConsumed: true,
});
const settling = (ownedTurnId: string | null): TurnState => ({
  phase: 'settling',
  ownedTurnId,
  resumeConsumed: true,
});

const userMsg = (text: string): Message => ({ text, role: 'user' });
const assistantMsg = (text: string): Message => ({ text, role: 'assistant' });

// The settle side-effects every terminal/orphan path appends.
const FINISH = [
  { kind: 'refreshCredits' },
  { kind: 'invalidateList' },
  { kind: 'invalidateInflight' },
];

// ── Normal: send → accepted → streaming → terminal ─────────────────────────
describe('turnReducer — normal', () => {
  it('send from idle → sending, optimistic user turn + sidebar upsert', () => {
    const { state, intents } = turnReducer(initialTurnState, {
      type: 'send',
      text: 'Hello',
    });
    expect(state).toEqual({
      phase: 'sending',
      ownedTurnId: null,
      resumeConsumed: false,
    });
    expect(intents).toEqual([
      { kind: 'optimisticUserTurn', text: 'Hello' },
      { kind: 'upsertConversation' },
    ]);
  });

  it('accepted send result from sending → streaming and owns the turnId', () => {
    const { state, intents } = turnReducer(
      { phase: 'sending', ownedTurnId: null, resumeConsumed: false },
      { type: 'sendResult', ownedTurnId: TURN },
    );
    expect(state).toEqual({
      phase: 'streaming',
      ownedTurnId: TURN,
      resumeConsumed: true,
    });
    expect(intents).toEqual([]);
  });

  it('alreadyInflight send result from sending → streaming, owns nothing', () => {
    const { state } = turnReducer(
      { phase: 'sending', ownedTurnId: null, resumeConsumed: false },
      { type: 'sendResult', ownedTurnId: null },
    );
    expect(state.phase).toBe('streaming');
    expect(state.ownedTurnId).toBeNull();
  });

  it('failed send from sending → idle, errors the assistant bubble', () => {
    const { state, intents } = turnReducer(
      { phase: 'sending', ownedTurnId: null, resumeConsumed: false },
      { type: 'sendFailed' },
    );
    expect(state.phase).toBe('idle');
    expect(intents).toEqual([{ kind: 'errorAssistant' }]);
  });

  it('delta while streaming appends to the last assistant', () => {
    const { state, intents } = turnReducer(streaming(TURN), {
      type: 'streamDelta',
      chunk: 'tok',
    });
    expect(state).toEqual(streaming(TURN));
    expect(intents).toEqual([{ kind: 'appendDelta', chunk: 'tok' }]);
  });

  it('done terminal → idle, settles the assistant with its messageId + finish', () => {
    const { state, intents } = turnReducer(streaming(TURN), {
      type: 'streamTerminal',
      outcome: 'done',
      messageId: 'msg-1',
    });
    expect(state).toEqual({
      phase: 'idle',
      ownedTurnId: null,
      resumeConsumed: true,
    });
    expect(intents).toEqual([
      { kind: 'settleAssistant', messageId: 'msg-1' },
      ...FINISH,
    ]);
  });

  it('error terminal → idle, errors the assistant + finish', () => {
    const { intents } = turnReducer(streaming(TURN), {
      type: 'streamTerminal',
      outcome: 'error',
      messageId: null,
    });
    expect(intents).toEqual([{ kind: 'errorAssistant' }, ...FINISH]);
  });

  it('stop → idle, settles (no messageId) + finish', () => {
    const { state, intents } = turnReducer(streaming(TURN), {
      type: 'stopped',
    });
    expect(state.phase).toBe('idle');
    expect(intents).toEqual([
      { kind: 'settleAssistant', messageId: null },
      ...FINISH,
    ]);
  });

  it('a delta arriving after settle is a no-op (subsumes the phaseRef guard)', () => {
    const idle: TurnState = {
      phase: 'idle',
      ownedTurnId: null,
      resumeConsumed: true,
    };
    const { state, intents } = turnReducer(idle, {
      type: 'streamDelta',
      chunk: 'late',
    });
    expect(state).toBe(idle);
    expect(intents).toEqual([]);
  });
});

// ── Wedged: idle + trailing unanswered user Message + not fetching ─────────
describe('deriveMessages — wedged Turn', () => {
  const base = [userMsg('are you there?')];

  it('synthesizes an error bubble when idle, unanswered, probe idle, not fetching', () => {
    const messages = deriveMessages({
      phase: 'idle',
      base,
      resumedTurnId: null,
      inflightSuccess: true,
      historyFetching: false,
    });
    expect(messages).toHaveLength(2);
    expect(messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', error: true }),
    );
  });

  it('does NOT synthesize while the mount revalidation is still fetching', () => {
    const messages = deriveMessages({
      phase: 'idle',
      base,
      resumedTurnId: null,
      inflightSuccess: true,
      historyFetching: true,
    });
    expect(messages).toEqual(base);
  });

  it('does NOT synthesize when a Turn is live from this client', () => {
    const messages = deriveMessages({
      phase: 'streaming',
      base,
      resumedTurnId: null,
      inflightSuccess: true,
      historyFetching: false,
    });
    expect(messages).toEqual(base);
  });

  it('does NOT synthesize when the probe reports a Turn in flight', () => {
    const messages = deriveMessages({
      phase: 'idle',
      base,
      resumedTurnId: TURN,
      inflightSuccess: true,
      historyFetching: false,
    });
    expect(messages).toEqual(base);
  });

  it('does NOT synthesize when history already ends on an assistant reply', () => {
    const answered = [userMsg('q'), assistantMsg('a')];
    const messages = deriveMessages({
      phase: 'idle',
      base: answered,
      resumedTurnId: null,
      inflightSuccess: true,
      historyFetching: false,
    });
    expect(messages).toEqual(answered);
  });
});

// ── Resume-after-refresh: cold open adopts a cached in-flight Turn ─────────
describe('turnReducer — resume', () => {
  it('reader start from idle adopts the lock turnId + splices the prefix', () => {
    const { state, intents } = turnReducer(initialTurnState, {
      type: 'readerStarted',
      inflightTurnId: TURN,
    });
    expect(state).toEqual({
      phase: 'streaming',
      ownedTurnId: TURN,
      resumeConsumed: true,
    });
    expect(intents).toEqual([
      { kind: 'cancelHistoryFetch' },
      { kind: 'ensureLoadingAssistant' },
      { kind: 'readHistoryForPrefix' },
    ]);
  });

  it('reader start during our own Turn (already streaming) is a no-op', () => {
    const s = streaming(TURN);
    const { state, intents } = turnReducer(s, {
      type: 'readerStarted',
      inflightTurnId: TURN,
    });
    expect(state).toBe(s);
    expect(intents).toEqual([]);
  });

  it('loaded prefix while streaming splices the fresh history', () => {
    const history = [userMsg('resumed q')];
    const { intents } = turnReducer(streaming(TURN), {
      type: 'historyPrefixLoaded',
      history,
    });
    expect(intents).toEqual([{ kind: 'spliceHistoryPrefix', history }]);
  });

  it('a failed prefix read (null) keeps the optimistic bubble — no intent', () => {
    const { intents } = turnReducer(streaming(TURN), {
      type: 'historyPrefixLoaded',
      history: null,
    });
    expect(intents).toEqual([]);
  });

  it('a prefix resolving after settle (idle) is dropped', () => {
    const { intents } = turnReducer(
      { phase: 'idle', ownedTurnId: null, resumeConsumed: true },
      { type: 'historyPrefixLoaded', history: [userMsg('late')] },
    );
    expect(intents).toEqual([]);
  });
});

// ── Orphan / missed-terminal: reader closed with no terminal ───────────────
describe('turnReducer — orphan / missed-terminal', () => {
  it('reader close while streaming → settling, re-reads history', () => {
    const { state, intents } = turnReducer(streaming(TURN), {
      type: 'readerClosed',
    });
    expect(state).toEqual(settling(TURN));
    expect(intents).toEqual([{ kind: 'readHistoryForReconcile' }]);
  });

  it('a stale close (not streaming) is a no-op', () => {
    const idle: TurnState = {
      phase: 'idle',
      ownedTurnId: null,
      resumeConsumed: true,
    };
    const { state, intents } = turnReducer(idle, { type: 'readerClosed' });
    expect(state).toBe(idle);
    expect(intents).toEqual([]);
  });

  it('missed terminal (assistant persisted) → adopt server truth, no refund', () => {
    const history = [userMsg('q'), assistantMsg('a')];
    const { state, intents } = turnReducer(settling(TURN), {
      type: 'historyReconciled',
      history,
    });
    expect(state).toEqual({
      phase: 'idle',
      ownedTurnId: null,
      resumeConsumed: true,
    });
    expect(intents).toEqual([{ kind: 'adoptHistory', history }, ...FINISH]);
  });

  it('true orphan (no assistant) owned by us → error + reconcile refund', () => {
    const { state, intents } = turnReducer(settling(TURN), {
      type: 'historyReconciled',
      history: [userMsg('q')],
    });
    expect(state.phase).toBe('idle');
    expect(intents).toEqual([
      { kind: 'errorAssistant' },
      { kind: 'reconcileTurn', turnId: TURN },
      ...FINISH,
    ]);
  });

  it('true orphan on an attached-only client (no turnId) does NOT reconcile', () => {
    const { intents } = turnReducer(settling(null), {
      type: 'historyReconciled',
      history: [userMsg('q')],
    });
    expect(intents).toEqual([{ kind: 'errorAssistant' }, ...FINISH]);
  });

  it('an unreadable history (null) falls to the orphan path', () => {
    const { intents } = turnReducer(settling(TURN), {
      type: 'historyReconciled',
      history: null,
    });
    expect(intents).toEqual([
      { kind: 'errorAssistant' },
      { kind: 'reconcileTurn', turnId: TURN },
      ...FINISH,
    ]);
  });
});
