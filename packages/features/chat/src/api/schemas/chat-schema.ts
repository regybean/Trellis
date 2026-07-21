import { z } from 'zod';

// A Conversation is a Mastra Memory thread (id = sessionId, resourceId =
// userId). This schema is the client-facing view of that thread.
export const selectChatSchema = z.object({
  sessionId: z.uuid(),
  userId: z.string(),
  createdAt: z.coerce.date(),
});

export type SelectChatSchema = z.infer<typeof selectChatSchema>;

// A row in the Conversation History list: enough to render the sidebar without
// loading any Messages. `folderId` is the Folder assignment read from the
// thread's `metadata.folderId` (null when un-foldered). Date Buckets are derived
// client-side from `updatedAt`, so the server only sorts — it sends no bucket.
export const selectConversationSummarySchema = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  updatedAt: z.coerce.date(),
  folderId: z.uuid().nullable(),
});

export type SelectConversationSummary = z.infer<
  typeof selectConversationSummarySchema
>;

// The single source of truth for the maximum Message length. The server schema
// (`SendChatRequest`) and the client-side pre-send guard (`useChat`) both read
// this one constant, so they cannot drift.
export const MAX_MESSAGE_LENGTH = 10_000;

export const DeleteChatRequest = z.object({
  sessionId: z.uuid(),
});

// The durable-stream control plane. A Turn (`turnId`, client-minted) is one
// in-flight generation for a Conversation (`conversationId`); it keys the job,
// the In-flight lock, the abort signal, and the refund guard. These procedures
// name the Conversation `conversationId` (the durable-stream vocabulary from the
// spec), where the legacy `stream`/`get`/`create` procedures still say
// `sessionId` for the same id — both resolve through the same ownership loader.
export const SendChatRequest = z.object({
  query: z.string().max(MAX_MESSAGE_LENGTH, 'Message too long'),
  conversationId: z.uuid(),
  turnId: z.uuid(),
});

export const StopChatRequest = z.object({
  conversationId: z.uuid(),
});

export const ReconcileTurnRequest = z.object({
  conversationId: z.uuid(),
  turnId: z.uuid(),
});

// Input to the pure `chat.stream` reader. `lastEventId` is populated by tRPC
// from the SSE `Last-Event-ID` header on reconnect (the field name is fixed by
// tRPC v11) — the client never sets it. Absent ⇒ tail from the head of the
// Stream; present ⇒ resume strictly after that Redis Stream entry id.
export const StreamReaderRequest = z.object({
  conversationId: z.uuid(),
  lastEventId: z.string().nullish(),
});

// What the reader re-emits per Redis Stream entry (via tRPC `tracked`). Derived
// from zod like every other type in this file, so the Generation worker
// (producer) and this reader (consumer) share one contract — and a malformed
// terminal is rejected at parse time rather than silently read as a delta (a
// non-terminal, which would keep the reader polling forever). A `delta` is a
// token the client appends; the three terminals mirror the worker's terminal
// entries: `done` carries the persisted assistant `messageId`; `cancelled`
// carries it iff a non-empty partial was persisted; `error` carries none. The
// reader closes after re-emitting any terminal.
export const streamReaderEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), chunk: z.string() }),
  z.object({ type: z.literal('done'), messageId: z.string().nullable() }),
  z.object({ type: z.literal('cancelled'), messageId: z.string().nullable() }),
  z.object({ type: z.literal('error') }),
]);

export type StreamReaderEvent = z.infer<typeof streamReaderEventSchema>;
