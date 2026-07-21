import { nsKey } from '@acme/redis';

// Redis key builders for the durable chat stream lifecycle. All keys go through
// nsKey so the app namespace prefix is applied consistently.

// Holds the token-delta Redis Stream for a Conversation's in-flight Turn.
// Created on first xAdd with a 600 s safety TTL; shortened to a brief
// post-terminal TTL by finalizeTurn (so late reconnects still read the
// terminal); discarded by the NEXT chat.send after it wins the lock
// (discardStaleStream) so a fresh Turn never re-reads the prior one.
export const chatStreamKey = (conversationId: string) =>
  nsKey('chat', 'stream', conversationId);

// SET NX EX lock — value = current turnId. At most one Turn per Conversation.
// Acquired by chat.send; released by the worker on terminal.
export const chatInflightKey = (conversationId: string) =>
  nsKey('chat', 'inflight', conversationId);

// SET key for the abort signal — value = turnId to abort.
// Written by chat.stop; read by the generation worker on each iteration.
export const chatAbortKey = (conversationId: string) =>
  nsKey('chat', 'abort', conversationId);

// SET NX guard — presence means this Turn's credits have already been refunded.
// Prevents double-refund between the worker error path and chat.reconcileTurn.
export const chatRefundedKey = (turnId: string) =>
  nsKey('chat', 'refunded', turnId);
