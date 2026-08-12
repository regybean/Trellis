import { HEAD_CURSOR } from '@acme/redis';

import type { StreamReaderEvent } from '../../../api/schemas/chat-schema';
import {
  chatStream,
  coalesce,
  isTerminalEvent,
} from '../../../api/services/chat-stream';
import { readInflightTurn } from '../../../api/services/chat-turn-lifecycle';

// Drive the chat token-stream reader to completion, returning the ordered
// { id, event } entries it re-emitted. This mirrors `chat.stream` EXACTLY — the
// same durable-stream tail with the in-flight-Turn lock probe as `keepGoing` and
// the delta-coalesce as `transform`, closing on a terminal — so the integration
// suites assert the real reader policy without re-deriving it. With no In-flight
// lock present the reader drains what exists and closes, keeping drains
// deterministic (no dependence on poll timing).
export async function drainChatStream(
  conversationId: string,
  lastEventId?: string,
) {
  const out: { id: string; event: StreamReaderEvent }[] = [];
  for await (const entry of chatStream(conversationId).tail(
    lastEventId ?? HEAD_CURSOR,
    {
      pollMinMs: 20,
      pollMaxMs: 20,
      keepGoing: async () => (await readInflightTurn(conversationId)) !== null,
      transform: coalesce,
    },
  )) {
    out.push(entry);
    if (isTerminalEvent(entry.event)) break;
  }
  return out;
}
