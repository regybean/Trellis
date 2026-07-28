import { redis } from '@acme/redis';

import type { StreamReaderEvent } from '../schemas/chat-schema';
import { chatConfig } from '../../config';
import { appEnv } from '../../env';
import { chatStreamKey } from '../chat-keys';

// The producer half of the chat Stream — symmetric to the reader/parser
// (chat-stream-parser.ts). `encodeEvent` is the pure inverse of the parser's
// `parseEntry`: both are typed off the one shared `streamReaderEventSchema`, so
// a change to the wire shape is a two-file edit the type checker enforces rather
// than a hunt across inline `xAdd` sites. `createStreamWriter` composes the
// encoder around the actual `xAdd` — it is the SOLE caller of `xAdd` for a
// Conversation's Stream and the one home of the safety-TTL "set once on first
// write" rule (the TTL lives with the writes it protects). Config-as-code
// (ADR 0026).
const config = chatConfig({ appEnv, isServer: true });

// The pure inverse of `parseEntry`: a validated event → the flat [k, v, …] field
// record `xAdd` writes. A `delta` carries only `chunk` (no `type`, so the reader
// reads an absent `type` as a delta); a terminal carries `type` and, on
// `done`/`cancelled`, `messageId` iff one was minted (a null id is omitted, and
// the reader reads an absent `messageId` back as null). The switch is exhaustive
// over the shared schema, so adding a terminal variant fails to type-check here
// until this producer handles it.
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

// A Stream writer bound to one Conversation's Stream. Exposes the intent-named
// operations the Generation worker's terminal policy speaks — append a delta,
// close with a terminal — never a raw `xAdd`. `done` always carries the persisted
// `messageId`; `cancelled` carries it iff a non-empty partial persisted (null
// otherwise); `error` carries none. The safety TTL is stamped once, on the first
// write, so a crashed worker (that never reaches `settleTurn`) cannot leave a
// dangling Stream key — after that `settleTurn` shortens it to the post-terminal
// window.
export function createStreamWriter(conversationId: string) {
  const streamKey = chatStreamKey(conversationId);
  let ttlSet = false;

  async function write(event: StreamReaderEvent) {
    await redis.xAdd(streamKey, '*', encodeEvent(event));
    if (!ttlSet) {
      await redis.expire(streamKey, config.STREAM_SAFETY_TTL);
      ttlSet = true;
    }
  }

  return {
    delta: (chunk: string) => write({ type: 'delta', chunk }),
    done: (messageId: string) => write({ type: 'done', messageId }),
    cancelled: (messageId: string | null) =>
      write({ type: 'cancelled', messageId }),
    error: () => write({ type: 'error' }),
  };
}
