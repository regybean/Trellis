import { Mastra } from '@mastra/core/mastra';

import { pgVector, postgresStore } from '@acme/rag';

import { chatAgent } from '../api/services/chat-agent';

// Central Mastra instance registering the chat agent, knowledge-base vector
// store and memory storage. Consumed by the root `mastra dev` / `mastra lint`
// entrypoint for Studio; the runtime agent is used directly by the chat router.
export const mastra: Mastra = new Mastra({
  agents: { chat: chatAgent },
  vectors: { pgVector },
  storage: postgresStore,
});
