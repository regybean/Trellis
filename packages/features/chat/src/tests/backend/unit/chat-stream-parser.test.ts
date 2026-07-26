/**
 * Chat stream-reader — pure-core unit tests.
 *
 * `parseEntry`, `coalesceBatch`, `rangeStart` and the terminal-type predicate
 * are the reader's pure logic, extracted from `tailChatStream` so they can be
 * exercised with fixtures rather than only implicitly through the live Redis
 * tail (covered by the router suite). No mocks, no I/O — the seam is pure.
 */
import { describe, expect, it } from 'vitest';

import type { RawStreamEntry } from '../../../api/services/chat-stream-parser';
import {
  coalesceBatch,
  isTerminalEvent,
  parseEntry,
  rangeStart,
} from '../../../api/services/chat-stream-parser';

// A delta entry carries only `chunk` (no `type`); a terminal carries `type`
// (+ optional `messageId`). Both arrive as a flat [k, v, k, v, ...] field array.
const delta = (id: string, chunk: string): RawStreamEntry => [
  id,
  ['chunk', chunk],
];
const terminal = (
  id: string,
  type: string,
  messageId?: string,
): RawStreamEntry => [
  id,
  messageId === undefined
    ? ['type', type]
    : ['type', type, 'messageId', messageId],
];

describe('parseEntry', () => {
  it('reads an absent type as a delta', () => {
    expect(parseEntry(['chunk', 'hello'])).toEqual({
      type: 'delta',
      chunk: 'hello',
    });
  });

  it('defaults a missing chunk to the empty string', () => {
    expect(parseEntry([])).toEqual({ type: 'delta', chunk: '' });
  });

  it('parses each well-formed terminal', () => {
    expect(parseEntry(['type', 'done', 'messageId', 'm1'])).toEqual({
      type: 'done',
      messageId: 'm1',
    });
    expect(parseEntry(['type', 'cancelled', 'messageId', 'm2'])).toEqual({
      type: 'cancelled',
      messageId: 'm2',
    });
    expect(parseEntry(['type', 'done'])).toEqual({
      type: 'done',
      messageId: null,
    });
  });

  it('throws on a terminal-type typo rather than degrading to a delta', () => {
    // A producer typo (`type: 'don'`) must be rejected at parse time. Silently
    // reading a present-but-unknown `type` as a delta would leave the reader
    // polling forever for a terminal that already (mis)fired.
    expect(() => parseEntry(['type', 'don'])).toThrow();
    expect(() => parseEntry(['type', 'DONE'])).toThrow();
  });
});

describe('isTerminalEvent', () => {
  it('is false for a delta and true for every terminal', () => {
    expect(isTerminalEvent({ type: 'delta', chunk: 'x' })).toBe(false);
    expect(isTerminalEvent({ type: 'done', messageId: 'm1' })).toBe(true);
    expect(isTerminalEvent({ type: 'cancelled', messageId: null })).toBe(true);
    expect(isTerminalEvent({ type: 'error' })).toBe(true);
  });
});

describe('rangeStart', () => {
  it('tails from the inclusive head when there is no cursor', () => {
    expect(rangeStart(null)).toBe('-');
  });

  it('resumes strictly after the cursor (exclusive) when one is given', () => {
    // '(id' is Redis' exclusive-start syntax, so a resuming client never
    // re-reads the entry it already had.
    expect(rangeStart('5-0')).toBe('(5-0');
  });
});

describe('coalesceBatch', () => {
  it('coalesces a cold-resume backlog into one delta carrying the last id', () => {
    // On a cold resume the whole accumulated backlog arrives in ONE xRange;
    // emitting it token-by-token forces O(n^2) client re-renders. One coalesced
    // delta carrying the LAST id lets a reconnect resume after everything seen.
    const out = [
      ...coalesceBatch([
        delta('1-0', 'Hel'),
        delta('2-0', 'lo '),
        delta('3-0', 'world'),
      ]),
    ];

    expect(out).toEqual([
      { id: '3-0', event: { type: 'delta', chunk: 'Hello world' } },
    ]);
  });

  it('passes a single live-poll delta through one-to-one', () => {
    // A live poll returns a single entry, so coalescing is a no-op during
    // normal streaming: one input entry ⇒ one emission.
    const out = [...coalesceBatch([delta('7-0', 'tok')])];

    expect(out).toEqual([
      { id: '7-0', event: { type: 'delta', chunk: 'tok' } },
    ]);
  });

  it('flushes buffered deltas before the terminal in the same batch', () => {
    const out = [
      ...coalesceBatch([
        delta('1-0', 'Hi'),
        delta('2-0', ' there'),
        terminal('3-0', 'done', 'm1'),
      ]),
    ];

    expect(out).toEqual([
      { id: '2-0', event: { type: 'delta', chunk: 'Hi there' } },
      { id: '3-0', event: { type: 'done', messageId: 'm1' } },
    ]);
  });

  it('emits a terminal with no preceding deltas on its own', () => {
    const out = [...coalesceBatch([terminal('4-0', 'error')])];

    expect(out).toEqual([{ id: '4-0', event: { type: 'error' } }]);
  });

  it('yields nothing for an empty batch', () => {
    expect([...coalesceBatch([])]).toEqual([]);
  });
});
