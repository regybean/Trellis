import type { StreamReaderEvent } from '../schemas/chat-schema';
import { streamReaderEventSchema } from '../schemas/chat-schema';

// The pure core of the chat stream reader: parsing a raw Redis Stream entry
// into a validated event, coalescing a batch of them, computing the resume
// cursor, and deciding what closes the reader. No Redis I/O lives here — this
// is the highest pure point of the reader, extracted so a unit test can cross
// the seam with fixtures (see docs/agents/testing.md). `tailChatStream`
// (chat-stream-reader.ts) composes these around the actual `xRange` polling.

// A raw Redis Stream entry as ioredis' `xRange` yields it: an `[id, fields]`
// tuple whose fields are a flat [k, v, k, v, ...] array.
export type RawStreamEntry = readonly [id: string, fields: string[]];

// A parsed, validated entry ready to hand to tRPC `tracked()`: the `id` the
// reconnecting client resumes from, and the discriminated event it carries.
export interface ReaderEntry {
  id: string;
  event: StreamReaderEvent;
}

const TERMINAL_TYPES = new Set(['done', 'cancelled', 'error']);

// The reader closes after re-emitting any terminal (`done`/`cancelled`/`error`);
// a `delta` keeps it polling. Predicate over the parsed event so callers never
// re-derive the terminal set.
export const isTerminalEvent = (event: StreamReaderEvent) =>
  TERMINAL_TYPES.has(event.type);

// A Redis Stream entry arrives as a flat [k, v, k, v, ...] field array. Delta
// entries carry only `chunk` (no `type`); terminals carry `type` (+ optional
// `messageId`). We normalise to the discriminated shape, then validate through
// the shared zod schema: an absent `type` is a delta, but a *present* `type`
// MUST be a known terminal. A producer typo (`type: 'don'`) therefore throws
// here rather than degrading to a non-terminal delta that keeps the reader
// polling forever.
export function parseEntry(fields: string[]): StreamReaderEvent {
  const rec = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) rec.set(key, value);
  }
  const type = rec.get('type');
  const candidate =
    type === undefined
      ? { type: 'delta', chunk: rec.get('chunk') ?? '' }
      : { type, messageId: rec.get('messageId') ?? null };
  return streamReaderEventSchema.parse(candidate);
}

// '-' = from the head (inclusive); '(id' = strictly after the last seen id
// (exclusive), so a resuming client never re-reads the entry it already had.
export const rangeStart = (cursor: string | null) =>
  cursor === null ? '-' : `(${cursor}`;

// Coalesce consecutive deltas within one xRange batch into a single emission.
// On a cold resume (no Last-Event-ID) the reader tails from the head, so the
// whole accumulated backlog arrives in ONE xRange. Emitting it token-by-token
// makes the client re-render — and re-parse the growing markdown string — once
// per token, i.e. O(n^2) work crammed into a burst: visible jitter for a long
// partial. One coalesced delta ⇒ one client render. Live polls return a single
// entry, so this is a no-op during normal streaming. The coalesced entry
// carries the LAST delta's id, so a client that reconnects with that
// Last-Event-ID resumes strictly after everything it already received.
export function* coalesceBatch(
  entries: readonly RawStreamEntry[],
): Generator<ReaderEntry> {
  let chunk = '';
  let deltaId: string | null = null;
  for (const [id, fields] of entries) {
    const event = parseEntry(fields);
    if (event.type === 'delta') {
      chunk += event.chunk;
      deltaId = id;
      continue;
    }
    // A terminal: flush any buffered deltas first, then emit it.
    if (deltaId !== null)
      yield { id: deltaId, event: { type: 'delta', chunk } };
    chunk = '';
    deltaId = null;
    yield { id, event };
  }
  // Flush deltas buffered when the batch ended without a terminal.
  if (deltaId !== null) yield { id: deltaId, event: { type: 'delta', chunk } };
}
