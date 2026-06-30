import { Memory } from '@mastra/memory';

import { titleModel } from '@acme/models';

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
    // Auto-name threads from the first user message so the conversation-history
    // sidebar shows meaningful titles instead of "New conversation". Runs
    // asynchronously after the turn, so it adds no latency to the response.
    generateTitle: {
      model: titleModel,
      instructions:
        'Generate a concise, descriptive title (max 6 words) for this conversation based on the first user message. Use plain text with no quotes or trailing punctuation.',
    },
  },
});
