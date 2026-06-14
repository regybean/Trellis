import { Memory } from '@mastra/memory';

import { postgresStore } from './storage';

// Conversation memory: the last 15 turns of a thread are loaded into context,
// matching the previous hand-rolled ChatMemory. Semantic recall is off, so no
// vector store or embedder is needed here.
export const memory = new Memory({
  storage: postgresStore,
  vector: false,
  options: {
    lastMessages: 15,
    semanticRecall: false,
  },
});
