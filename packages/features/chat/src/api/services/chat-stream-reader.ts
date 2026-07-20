import { redis } from '@acme/redis';

import type { StreamReaderEvent } from '../schemas/chat-schema';
import { chatStreamKey } from '../chat-keys';
import { readInflightTurn } from './chat-turn-lifecycle';

// Poll cadence while a Turn is still in-flight. The reader tails the Redis
// Stream on the SHARED redis connection, so it must never issue a blocking
// XREAD — that would stall every other Redis op in the process. It polls XRANGE
// instead; the spec accepts the resulting read amplification (see spec #44).
const POLL_INTERVAL_MS = 100;

const TERMINAL_TYPES = new Set(['done', 'cancelled', 'error']);

interface ReaderEntry {
  id: string;
  event: StreamReaderEvent;
}

// A Redis Stream entry arrives as a flat [k, v, k, v, ...] field array. Delta
// entries carry only `chunk`; terminals carry `type` (+ optional `messageId`).
function parseEntry(fields: string[]): StreamReaderEvent {
  const rec = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) rec.set(key, value);
  }
  const type = rec.get('type');
  if (type === 'done')
    return { type: 'done', messageId: rec.get('messageId') ?? null };
  if (type === 'cancelled')
    return { type: 'cancelled', messageId: rec.get('messageId') ?? null };
  if (type === 'error') return { type: 'error' };
  return { type: 'delta', chunk: rec.get('chunk') ?? '' };
}

// A delay that also settles early on abort, so a disconnecting client tears the
// reader down within one tick rather than after the full poll interval.
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// '-' = from the head (inclusive); '(id' = strictly after the last seen id
// (exclusive), so a resuming client never re-reads the entry it already had.
const rangeStart = (cursor: string | null) =>
  cursor === null ? '-' : `(${cursor}`;

// Pure, stateless tail of a Conversation's token Stream — no writes, no LLM, no
// lock operations. Yields each Redis entry as `{ id, event }`; the router hands
// `id` to tRPC `tracked()` so a reconnecting client (passing `lastEventId`)
// resumes exactly here. The generator closes when it re-emits a terminal, when
// the client aborts, or when no Turn is in-flight and the Stream is drained
// (idle or orphaned — the client polls or reconciles on reconnect).
export async function* tailChatStream(
  conversationId: string,
  lastEventId: string | null,
  signal?: AbortSignal,
): AsyncGenerator<ReaderEntry> {
  const streamKey = chatStreamKey(conversationId);
  let cursor = lastEventId;
  // Once the In-flight lock is gone we take exactly one more drain (no sleep) to
  // catch a terminal written just before the worker released the lock, then close.
  let draining = false;

  while (!signal?.aborted) {
    const entries = await redis.xRange(streamKey, rangeStart(cursor), '+');
    for (const [id, fields] of entries) {
      cursor = id;
      const event = parseEntry(fields);
      yield { id, event };
      if (TERMINAL_TYPES.has(event.type)) return;
    }

    if (draining) return;

    if (await readInflightTurn(conversationId)) {
      await delay(POLL_INTERVAL_MS, signal);
    } else {
      draining = true;
    }
  }
}
