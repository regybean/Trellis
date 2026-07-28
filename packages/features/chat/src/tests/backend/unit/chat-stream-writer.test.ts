/**
 * Chat stream-writer — pure-core unit tests.
 *
 * `encodeEvent` is the producer's pure inverse of the reader's `parseEntry`:
 * both are typed off the one shared `streamReaderEventSchema`. Encoding an event
 * to its flat Redis field record and parsing it back must round-trip to the same
 * event — that identity is the whole point of a single producer + single
 * consumer, so a wire-shape drift on either side fails here. No Redis I/O; the
 * seam is pure (the stateful `createStreamWriter` xAdd/TTL side is covered
 * through the worker seam in the generation-processor integration test).
 */
import { describe, expect, it } from 'vitest';

import type { StreamReaderEvent } from '../../../api/schemas/chat-schema';
import { parseEntry } from '../../../api/services/chat-stream-parser';
import { encodeEvent } from '../../../api/services/chat-stream-writer';

// `xAdd` takes a flat [k, v, …] field array; the reader's `parseEntry` consumes
// the same shape. Flattening the writer's field record is exactly what ioredis
// does on the wire, so this crosses the real producer↔consumer boundary.
const flatten = (record: Record<string, string>) =>
  Object.entries(record).flat();

describe('encodeEvent ⇄ parseEntry round-trip', () => {
  it.each<StreamReaderEvent>([
    { type: 'delta', chunk: 'hello world' },
    { type: 'delta', chunk: '' },
    { type: 'done', messageId: 'm1' },
    { type: 'done', messageId: null },
    { type: 'cancelled', messageId: 'm2' },
    { type: 'cancelled', messageId: null },
    { type: 'error' },
  ])('encodes %o to a record the parser reads back identically', (event) => {
    expect(parseEntry(flatten(encodeEvent(event)))).toEqual(event);
  });

  it('writes a delta with only a chunk field (no type ⇒ the reader reads a delta)', () => {
    expect(encodeEvent({ type: 'delta', chunk: 'tok' })).toEqual({
      chunk: 'tok',
    });
  });

  it('omits messageId on a null terminal so the reader reads it back as null', () => {
    expect(encodeEvent({ type: 'done', messageId: null })).toEqual({
      type: 'done',
    });
    expect(encodeEvent({ type: 'cancelled', messageId: null })).toEqual({
      type: 'cancelled',
    });
  });
});
