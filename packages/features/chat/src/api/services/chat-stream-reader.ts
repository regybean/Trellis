import { redis } from '@acme/redis';

import type { ReaderEntry } from './chat-stream-parser';
import { chatStreamKey } from '../chat-keys';
import {
  coalesceBatch,
  isTerminalEvent,
  rangeStart,
} from './chat-stream-parser';
import { readInflightTurn } from './chat-turn-lifecycle';

// Poll cadence while a Turn is still in-flight. The reader tails the Redis
// Stream on the SHARED redis connection, so it must never issue a blocking
// XREAD — that would stall every other Redis op in the process. It polls XRANGE
// instead; the spec accepts the resulting read amplification (see spec #44).
const POLL_INTERVAL_MS = 100;

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

// Pure, stateless tail of a Conversation's token Stream — no writes, no LLM, no
// lock operations. Yields each Redis entry as `{ id, event }`; the router hands
// `id` to tRPC `tracked()` so a reconnecting client (passing `lastEventId`)
// resumes exactly here. The generator closes when it re-emits a terminal, when
// the client aborts, or when no Turn is in-flight and the Stream is drained
// (idle or orphaned — the client polls or reconciles on reconnect). The parse /
// coalesce / cursor / terminal logic is the pure seam in chat-stream-parser.ts;
// this composes it around the actual xRange polling and lock probe.
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

    for (const entry of coalesceBatch(entries)) {
      cursor = entry.id;
      yield entry;
      if (isTerminalEvent(entry.event)) return;
    }

    if (draining) return;

    if (await readInflightTurn(conversationId)) {
      await delay(POLL_INTERVAL_MS, signal);
    } else {
      draining = true;
    }
  }
}
