import type { StreamCodec, StreamEntry } from '@acme/redis';
import { createDurableStream } from '@acme/redis';

import type { StreamReaderEvent } from '../schemas/chat-schema';
import { env } from '../../env';
import { chatStreamKey } from '../chat-keys';
import { streamReaderEventSchema } from '../schemas/chat-schema';

// The chat token Stream, on the shared `@acme/redis` durable-stream primitive
// (#196). The primitive owns the transport — the XRANGE poll loop, the
// abort-aware poll `delay`, the cursor policy, atomic append-with-TTL — that this
// feature used to hand-copy alongside ingest and notifications. What stays here
// is only chat's own: the wire codec (encode/decode off the one
// `streamReaderEventSchema`), the delta-coalesce it passes as the tail
// `transform`, and the terminal predicate the router closes on. Config-as-code
// (@acme/env ADR 0001).

// The pure inverse of `decodeEvent`: a validated event → the flat field record
// `xAdd` writes. A `delta` carries only `chunk` (no `type`, so an absent `type`
// reads back as a delta); a terminal carries `type` and, on `done`/`cancelled`,
// `messageId` iff one was minted (a null id is omitted, read back as null). The
// switch is exhaustive over the shared schema, so adding a terminal variant fails
// to type-check here until this producer handles it.
export function encodeEvent(event: StreamReaderEvent) {
  const fields: Record<string, string> = {};
  switch (event.type) {
    case 'delta': {
      fields.chunk = event.chunk;
      return fields;
    }
    case 'done':
    case 'cancelled': {
      fields.type = event.type;
      if (event.messageId !== null) fields.messageId = event.messageId;
      return fields;
    }
    case 'error': {
      fields.type = 'error';
      return fields;
    }
  }
}

// The inverse of `encodeEvent`: the primitive folds the raw Redis field array to
// a record and hands it here. An absent `type` is a delta; a *present* `type`
// MUST be a known terminal — a producer typo (`type: 'don'`) therefore throws at
// parse time rather than degrading to a non-terminal delta that would keep the
// reader polling forever.
export function decodeEvent(fields: Record<string, string>): StreamReaderEvent {
  const type = fields.type;
  const candidate =
    type === undefined
      ? { type: 'delta', chunk: fields.chunk ?? '' }
      : { type, messageId: fields.messageId ?? null };
  return streamReaderEventSchema.parse(candidate);
}

const TERMINAL_TYPES = new Set(['done', 'cancelled', 'error']);

// The reader closes after re-emitting any terminal (`done`/`cancelled`/`error`);
// a `delta` keeps it polling. The router breaks its tail loop on this.
export const isTerminalEvent = (event: StreamReaderEvent) =>
  TERMINAL_TYPES.has(event.type);

// Coalesce consecutive deltas within one polled batch into a single emission —
// the tail `transform`. On a cold resume the whole accumulated backlog arrives in
// ONE xRange; emitting it token-by-token makes the client re-parse the growing
// markdown once per token (O(n^2) jitter). One coalesced delta ⇒ one render. Live
// polls return a single entry, so this is a no-op during normal streaming. The
// coalesced entry carries the LAST delta's id, so a reconnect resumes strictly
// after everything already received.
export function coalesce(
  batch: StreamEntry<StreamReaderEvent>[],
): StreamEntry<StreamReaderEvent>[] {
  const out: StreamEntry<StreamReaderEvent>[] = [];
  let chunk = '';
  let deltaId: string | null = null;
  for (const { id, event } of batch) {
    if (event.type === 'delta') {
      chunk += event.chunk;
      deltaId = id;
      continue;
    }
    // A terminal: flush any buffered deltas first, then emit it.
    if (deltaId !== null)
      out.push({ id: deltaId, event: { type: 'delta', chunk } });
    chunk = '';
    deltaId = null;
    out.push({ id, event });
  }
  // Flush deltas buffered when the batch ended without a terminal.
  if (deltaId !== null)
    out.push({ id: deltaId, event: { type: 'delta', chunk } });
  return out;
}

const codec: StreamCodec<StreamReaderEvent> = {
  encode: encodeEvent,
  decode: decodeEvent,
};

// One Conversation's durable token Stream. The safety TTL is (re)stamped
// atomically on every append (`xAddWithTtl`), so a crashed worker that never
// reaches `settleTurn` cannot leave a dangling key; `settleTurn` later shortens
// it to the post-terminal window.
export const chatStream = (conversationId: string) =>
  createDurableStream<StreamReaderEvent>({
    key: chatStreamKey(conversationId),
    ttlSeconds: env.STREAM_SAFETY_TTL,
    codec,
  });

// A Stream writer bound to one Conversation. Exposes the intent-named operations
// the Generation worker's terminal policy speaks — append a delta, close with a
// terminal — never a raw `xAdd`. `done` always carries the persisted `messageId`;
// `cancelled` carries it iff a non-empty partial persisted (null otherwise);
// `error` carries none.
export function createStreamWriter(conversationId: string) {
  const stream = chatStream(conversationId);
  const write = (event: StreamReaderEvent) => stream.write(event);

  return {
    delta: (chunk: string) => write({ type: 'delta', chunk }),
    done: (messageId: string) => write({ type: 'done', messageId }),
    cancelled: (messageId: string | null) =>
      write({ type: 'cancelled', messageId }),
    error: () => write({ type: 'error' }),
  };
}
